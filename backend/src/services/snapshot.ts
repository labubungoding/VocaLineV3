import type { App } from '../app.ts';
import type { Params, Row } from '../db/db.ts';
import type { StaffUser, TabletIdentity } from '../http/router.ts';
import { alarmStatus, mealLabel } from '../mapping/mapping.ts';
import { getSettings } from './core.ts';

const ms = (col: string) => `(extract(epoch from ${col}) * 1000)::bigint`;

type L = Row[];

async function base(app: App, wards: L, rooms: L, beds: L, tablets: L, patients: L, alarms: L, schedules: L, users: L, commands: L) {
  const s = await getSettings(app.db);
  return {
    version: 1, wards, rooms, beds, tablets, patients, alarms, schedules, users,
    settings: {
      ages: { teenMin: s.ageMinTeen, teenMax: s.ageMaxTeen, adultMin: s.ageMinAdult, adultMax: s.ageMaxAdult, elderMin: s.ageMinElder },
      escalation: { red: s.escalationRedMinutes, orange: s.escalationOrangeMinutes },
    },
    commands,
    setupComplete: s.setupCompletedAt != null,
    serverTime: Date.now(),
  } as Record<string, unknown>;
}

const rooms = (app: App, where: string, p: Params) =>
  app.db.list(`select r.id, r.ward_id, r.number from public.rooms r where ${where} order by r.sort_order, r.number`, p);

const beds = (app: App, where: string, p: Params) => app.db.list(`
  select b.id, b.room_id, b.number as label, t.id as tablet_id
  from public.beds b
  join public.rooms r on r.id = b.room_id
  left join public.tablets t on t.bed_id = b.id and t.disabled_at is null
  where ${where}
  order by r.sort_order, r.number, b.number`, p);

async function tablets(app: App, where: string, p: Params) {
  return (await app.db.list(`
    select t.id, coalesce(t.label, t.device_code) as label, t.device_code, t.status::text as status,
           t.battery_level, ${ms('t.last_seen_at')} as last_seen, t.disabled_at is not null as disabled
    from public.tablets t
    left join public.beds b on b.id = t.bed_id
    left join public.rooms r on r.id = b.room_id
    where ${where}
    order by t.label nulls last, t.device_code`, p)).map((r) => ({
    id: r.id, label: r.label, deviceId: r.deviceCode, online: r.status !== 'offline',
    battery: r.batteryLevel == null ? 100 : r.batteryLevel, lastSeen: r.lastSeen == null ? 0 : r.lastSeen, disabled: r.disabled === true,
  }));
}

async function alarms(app: App, where: string, p: Params, withPatientName: boolean) {
  return (await app.db.list(`
    select a.id, a.bed_id, a.ward_id, a.level::text as level, a.status::text as status, a.summary,
           a.handled_by, ${ms('a.created_at')} as created_at, ${ms('a.handled_at')} as handled_at,
           coalesce(${ms('a.resolved_at')}, ${ms('a.cancelled_at')}) as resolved_at, p.full_name as patient_name
    from public.alarms a
    left join public.patients p on p.id = a.patient_id
    where ${where}
    order by a.created_at desc
    limit 2000`, p)).map((r) => ({
    id: r.id, bedId: r.bedId, level: r.level, status: alarmStatus(r.status), summary: r.summary == null ? '' : r.summary,
    createdAt: r.createdAt, patientName: withPatientName ? r.patientName : null, wardId: r.wardId,
    handledBy: r.handledBy, handledAt: r.handledAt, resolvedAt: r.resolvedAt,
  }));
}

async function schedules(app: App, where: string, p: Params) {
  return (await app.db.list(`
    select id, ward_id, room_id, time_of_day, type::text as type, is_active, extra_message
    from public.meal_schedules where ${where} order by time_of_day`, p)).map((r) => ({
    id: r.id, scope: r.roomId == null ? 'ward' : 'room', wardId: r.wardId, roomId: r.roomId, time: r.timeOfDay,
    type: mealLabel(r.type, r.extraMessage), active: r.isActive === true,
  }));
}

async function users(app: App, where: string, p: Params) {
  return (await app.db.list(`
    select p.id, p.full_name, p.email, p.role::text as role, p.is_active,
           (select nw.ward_id from public.nurse_wards nw where nw.nurse_id = p.id limit 1) as ward_id
    from public.profiles p where ${where} order by p.full_name`, p)).map((r) => ({
    id: r.id, name: r.fullName, email: r.email as string | null, role: r.role, wardId: r.wardId, active: r.isActive === true,
  }));
}

async function commands(app: App, where: string, p: Params) {
  return (await app.db.list(`
    select distinct on (tt.tablet_id) tt.id, t.device_code, tt.kind::text as kind, tt.status::text as status,
           tt.detail, ${ms('tt.created_at')} as created_at, ${ms('tt.finished_at')} as finished_at
    from public.tablet_tests tt
    join public.tablets t on t.id = tt.tablet_id
    left join public.beds b on b.id = t.bed_id
    left join public.rooms r on r.id = b.room_id
    where tt.created_at > now() - interval '10 minutes' and (${where})
    order by tt.tablet_id, tt.created_at desc`, p)).map((r) => ({
    id: r.id, deviceId: r.deviceCode, type: r.kind, status: r.status, result: r.detail, createdAt: r.createdAt, finishedAt: r.finishedAt,
  }));
}

export async function forStaff(app: App, s: StaffUser) {
  const admin = s.role === 'superadmin';
  const w = s.wardIds;
  if (!admin && w.length === 0) return base(app, [], [], [], [], [], [], [], [], []);
  const wf = admin ? 'is not null' : 'in (:wards)';
  const p = { wards: w };
  const wardRows = await app.db.list(`select id, name from public.wards where id ${wf} order by name`, p);
  const rm = await rooms(app, `r.ward_id ${wf}`, p);
  const bd = await beds(app, `r.ward_id ${wf}`, p);
  const tb = await tablets(app, admin ? 't.paired_at is not null or t.disabled_at is not null' : 'r.ward_id in (:wards)', p);
  const patients = (await app.db.list(`
    select id, bed_id, full_name, age, diagnosis, ${ms('activated_at')} as admitted_at
    from public.patients where ward_id ${wf}`, p)).map((r) => ({
    id: r.id, bedId: r.bedId,
    name: admin ? null : r.fullName, age: admin ? null : r.age, diagnosis: admin ? null : r.diagnosis, admittedAt: r.admittedAt,
  }));
  const alarmWhere = admin ? "a.created_at > now() - interval '30 days'"
    : "a.ward_id in (:wards) and (a.status in ('waiting','handling') or a.created_at > now() - interval '7 days')";
  const al = await alarms(app, `${alarmWhere} and a.level <> 'test'`, p, !admin);
  const sc = await schedules(app, `ward_id ${wf}`, p);
  const us = await users(app, admin ? 'true'
    : 'p.id = :me or p.id in (select nurse_id from public.nurse_wards where ward_id in (:wards))', { wards: w, me: s.id });
  const cm = await commands(app, admin ? 'true' : 'r.ward_id in (:wards)', p);
  return base(app, wardRows, rm, bd, tb, patients, al, sc, us, cm);
}

export async function forTablet(app: App, t: TabletIdentity) {
  let aiEnabled = true;
  if (t.id != null) {
    const r = await app.db.one('select ai_enabled from public.tablets where id = :t', { t: t.id });
    aiEnabled = r ? r.aiEnabled === true : true;
  }
  const me = { tabletId: t.id, deviceId: t.deviceCode, bedId: t.bedId, aiEnabled };
  let out: Record<string, unknown>;
  if (t.bedId == null) {
    const tb = t.id == null ? [] : await tablets(app, 't.id = :t', { t: t.id });
    out = await base(app, [], [], [], tb, [], [], [], [], []);
  } else {
    const p = { bed: t.bedId, t: t.id };
    const wardOfBed = '(select r.ward_id from public.beds b join public.rooms r on r.id = b.room_id where b.id = :bed)';
    const roomOfBed = '(select room_id from public.beds where id = :bed)';
    const wards = await app.db.list(`select id, name from public.wards where id = ${wardOfBed}`, p);
    const rm = await rooms(app, `r.id = ${roomOfBed}`, p);
    const bd = await beds(app, 'b.id = :bed', p);
    const tb = await tablets(app, 't.id = :t', p);
    const patients = (await app.db.list(`
      select id, bed_id, nickname, age, ${ms('activated_at')} as admitted_at from public.patients where bed_id = :bed`, p)).map((r) => ({
      id: r.id, bedId: r.bedId, name: r.nickname, age: r.age, diagnosis: null, admittedAt: r.admittedAt,
    }));
    const al = await alarms(app, "a.bed_id = :bed and a.status in ('waiting','handling') and a.level <> 'test'", p, false);
    const sc = await schedules(app, `ward_id = ${wardOfBed} and (room_id is null or room_id = ${roomOfBed})`, p);
    const us = await users(app, "p.id in (select handled_by from public.alarms where bed_id = :bed and status = 'handling')", p);
    for (const u of us) u.email = null;
    const cm = await commands(app, "t.id = :t and tt.status = 'pending'", p);
    out = await base(app, wards, rm, bd, tb, patients, al, sc, us, cm);
  }
  out.me = me;
  return out;
}
