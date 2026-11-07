import type { App } from '../app.ts';
import type { Db, Row } from '../db/db.ts';
import { isUniqueViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import { levelRank } from '../mapping/mapping.ts';
import { Events } from '../realtime/hub.ts';
import { audit, loadBed, type BedContext } from './core.ts';

export interface Alarm {
  id: string; bedId: string; wardId: string; tabletId: string | null; level: string; status: string;
  handledBy: string | null; createdAt: string | null;
}

const COLS = 'id, bed_id, ward_id, tablet_id, level::text as level, status::text as status, handled_by, created_at';

function map(r: Row): Alarm {
  return { id: r.id, bedId: r.bedId, wardId: r.wardId, tabletId: r.tabletId, level: r.level, status: r.status,
    handledBy: r.handledBy, createdAt: r.createdAt };
}
async function one(db: Db, sql: string, p: Record<string, unknown>): Promise<Alarm | null> {
  const r = await db.one(sql, p);
  return r ? map(r) : null;
}

export const brief = (a: Alarm) => ({ id: a.id, level: a.level, status: a.status });

export function toMap(a: Alarm) {
  return { id: a.id, bedId: a.bedId, wardId: a.wardId, tabletId: a.tabletId, level: a.level, status: a.status,
    handledBy: a.handledBy, createdAt: a.createdAt };
}

function notifyNew(app: App, a: Alarm, ctx: BedContext) {
  app.hub.toWard(ctx.bed.wardId, Events.alarmNew(a.id, a.level, ctx.bed.id, ctx.bed.roomNumber, ctx.bed.number));
  app.hub.toTablet(a.tabletId, Events.alarmStatus(a.id, a.level, a.status, null));
}

export async function raise(app: App, ctx: BedContext, tabletId: string | null, level: string, source: string,
  summary: string | null, clientAlarmId: string | null): Promise<{ alarm: Alarm; created: boolean }> {
  const db = app.db;
  if (clientAlarmId) {
    const dup = await one(db, `select ${COLS} from public.alarms where client_alarm_id = :c`, { c: clientAlarmId });
    if (dup) return { alarm: dup, created: false };
  }
  const open = (await db.list(`select ${COLS} from public.alarms
     where bed_id = :bed and status in ('waiting','handling') and level <> 'test'
     order by created_at`, { bed: ctx.bed.id })).map(map);
  if (level !== 'test') {
    let highest: Alarm | null = null;
    for (const a of open) if (!highest || levelRank(a.level) > levelRank(highest.level)) highest = a;
    if (highest && levelRank(highest.level) >= levelRank(level)) return { alarm: highest, created: false };
    const orange = open.find((a) => a.level === 'orange');
    if (orange && level === 'red') {
      const up = await one(db, `update public.alarms
           set level = 'red', source = cast(:source as alarm_source), summary = :summary,
               status = 'waiting', handled_by = null, handled_at = null
         where id = :id
        returning ${COLS}`, { source, summary, id: orange.id });
      if (up) {
        notifyNew(app, up, ctx);
        return { alarm: up, created: true };
      }
    }
  }
  let created: Alarm;
  try {
    created = (await one(db, `
      insert into public.alarms (bed_id, ward_id, patient_id, tablet_id, level, source, summary, client_alarm_id)
      values (:bed, :ward, :patient, :tablet, cast(:level as alarm_level), cast(:source as alarm_source), :summary, :client)
      returning ${COLS}`, {
      bed: ctx.bed.id, ward: ctx.bed.wardId, patient: ctx.patient ? ctx.patient.id : null, tablet: tabletId,
      level, source, summary: summary == null || summary.trim() === '' ? null : summary, client: clientAlarmId,
    }))!;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await one(db, `select ${COLS} from public.alarms
        where (client_alarm_id = :client)
           or (bed_id = :bed and level = cast(:level as alarm_level) and status in ('waiting','handling'))
        limit 1`, { client: clientAlarmId, bed: ctx.bed.id, level });
    if (existing) return { alarm: existing, created: false };
    throw e;
  }
  notifyNew(app, created, ctx);
  await audit(db, 'system', null, 'alarm.raise', created.id, { level, source });
  return { alarm: created, created: true };
}

export async function raiseForBed(app: App, bedId: string, tabletId: string | null, level: string, source: string,
  clientAlarmId: string | null) {
  return raise(app, await loadBed(app.db, bedId, false), tabletId, level, source, null, clientAlarmId);
}

async function getForStaff(db: Db, alarmId: string, staff: StaffUser): Promise<Alarm> {
  const a = await one(db, `select ${COLS} from public.alarms where id = :id`, { id: alarmId });
  if (!a) throw ApiError.notFound('Alarm');
  if (!staff.wardIds.includes(a.wardId)) throw ApiError.forbidden('Alarm di luar bangsal Anda');
  return a;
}

async function staffName(db: Db, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await db.one('select full_name from public.profiles where id = :id', { id });
  return r ? r.fullName : null;
}

export async function claim(app: App, alarmId: string, staff: StaffUser) {
  const db = app.db;
  await getForStaff(db, alarmId, staff);
  const a = await one(db, `select ${COLS} from public.claim_alarm(:a, :n)`, { a: alarmId, n: staff.id });
  if (!a || a.id == null) throw ApiError.notFound('Alarm');
  if (a.status !== 'handling' || a.handledBy !== staff.id) {
    const name = await staffName(db, a.handledBy);
    throw ApiError.conflict('alarm_taken', name != null ? `Sudah ditangani ${name}` : 'Alarm sudah tidak menunggu',
      { handlerName: name, status: a.status });
  }
  app.hub.toTablet(a.tabletId, Events.alarmStatus(a.id, a.level, 'handling', staff.fullName));
  await audit(db, 'nurse', staff.id, 'alarm.claim', a.id);
  return { ...toMap(a), handlerName: staff.fullName };
}

export async function resolve(app: App, alarmId: string, staff: StaffUser) {
  const db = app.db;
  const a = await getForStaff(db, alarmId, staff);
  if (a.status === 'done' || a.status === 'cancelled') return toMap(a);
  const done = (await one(db, `update public.alarms
       set status = 'done', resolved_by = :n, resolved_at = now(),
           handled_by = coalesce(handled_by, :n), handled_at = coalesce(handled_at, now())
     where id = :id
    returning ${COLS}`, { n: staff.id, id: alarmId }))!;
  app.hub.toTablet(a.tabletId, Events.alarmStatus(alarmId, a.level, 'done', staff.fullName));
  await audit(db, 'nurse', staff.id, 'alarm.resolve', alarmId);
  return toMap(done);
}

export async function handover(app: App, alarmId: string, staff: StaffUser) {
  const db = app.db;
  const a = await getForStaff(db, alarmId, staff);
  if (a.status !== 'handling' || a.handledBy !== staff.id) throw ApiError.conflict('not_yours', 'Alarm ini tidak sedang Anda tangani');
  const back = (await one(db, `update public.alarms set status = 'waiting', handled_by = null, handled_at = null
     where id = :id returning ${COLS}`, { id: alarmId }))!;
  app.hub.toTablet(a.tabletId, Events.alarmStatus(alarmId, a.level, 'waiting', null));
  await audit(db, 'nurse', staff.id, 'alarm.handover', alarmId);
  return toMap(back);
}

export async function cancelFromTablet(app: App, alarmId: string, tabletId: string | null) {
  const db = app.db;
  const a = await one(db, `select ${COLS} from public.alarms where id = :id and tablet_id = :t`, { id: alarmId, t: tabletId });
  if (!a) throw ApiError.notFound('Alarm');
  if (a.level !== 'orange') throw ApiError.forbidden('Alarm merah tidak bisa dibatalkan dari tablet');
  if (a.status !== 'waiting') throw ApiError.conflict('already_handled', 'Perawat sudah menangani alarm ini');
  await db.update("update public.alarms set status = 'cancelled', cancelled_at = now() where id = :id", { id: alarmId });
  await audit(db, 'tablet', tabletId, 'alarm.cancel', alarmId);
  return { id: alarmId, status: 'cancelled' };
}

export async function openAlarmsOf(app: App, staff: StaffUser) {
  return app.db.list(`
    select a.id, a.level::text as level, a.status::text as status, a.created_at, a.handled_at,
           a.bed_id, b.number as bed_number, r.number as room_number
    from public.alarms a
    join public.beds b on b.id = a.bed_id
    join public.rooms r on r.id = b.room_id
    where a.handled_by = :n and a.status = 'handling'
    order by a.created_at`, { n: staff.id });
}

export async function wardQueue(app: App, wardId: string, filter: string) {
  const statusClause = filter === 'waiting' ? "a.status = 'waiting'"
    : filter === 'handling' ? "a.status = 'handling'" : "a.status in ('waiting','handling')";
  const rows = await app.db.list(`
    select a.id, a.level::text as level, a.status::text as status, a.summary, a.escalated,
           a.created_at, a.handled_at, a.handled_by, h.full_name as handler_name,
           a.bed_id, b.number as bed_number, r.number as room_number,
           p.nickname as patient_nickname, p.full_name as patient_name,
           p.age as patient_age, p.diagnosis as patient_diagnosis
    from public.alarms a
    join public.beds b on b.id = a.bed_id
    join public.rooms r on r.id = b.room_id
    left join public.patients p on p.id = a.patient_id
    left join public.profiles h on h.id = a.handled_by
    where a.ward_id = :ward and ${statusClause}
    order by case a.level when 'red' then 0 when 'orange' then 1 else 2 end, a.created_at`, { ward: wardId });
  return { waitingCount: rows.filter((r) => r.status === 'waiting').length, alarms: rows };
}
