import type { App } from '../app.ts';
import { isIntegrityViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import { addDays, localDate, startOfLocalDay, startOfToday } from '../lib/util.ts';
import { personaForAge, type AgeRanges } from '../mapping/mapping.ts';
import { Events } from '../realtime/hub.ts';
import { audit, getSettings, loadBed, tabletSession } from './core.ts';

export async function overview(app: App) {
  const db = app.db;
  const stats: Record<string, number> = {};
  for (const [k, s] of [['online', 'online'], ['offline', 'offline'], ['lowBattery', 'low-battery']]) {
    stats[k] = await db.count(`select count(*) from public.tablets
      where paired_at is not null and disabled_at is null and status = cast(:s as tablet_status)`, { s });
  }
  stats.alarmsToday = await db.count("select count(*) from public.alarms where level <> 'test' and created_at >= cast(:since as timestamptz)",
    { since: startOfToday(app.cfg.timezone) });
  return { stats, services: await db.list('select name, ok, detail, checked_at from public.service_status order by name') };
}

export async function setupProgress(app: App) {
  const db = app.db;
  const wards = await db.count('select count(*) from public.wards');
  const nurses = await db.count("select count(*) from public.profiles where role = 'nurse'");
  const rows = (await db.list(`
    select s.bed_id, s.bed_code, s.room_number, s.bed_number, s.tablet_id, s.tablet_status::text as tablet_status
    from public.bed_states s order by s.room_number, s.bed_number`)).map((b) => ({
    bedId: b.bedId, code: b.bedCode, room: b.roomNumber, bed: b.bedNumber,
    status: b.tabletId == null ? 'pending' : b.tabletStatus === 'offline' ? 'fail' : 'ready',
  }));
  const ready = rows.filter((r) => r.status === 'ready').length;
  return {
    steps: {
      layout: wards > 0 && rows.length > 0 ? 'done' : 'current',
      nurses: nurses > 0 ? 'done' : 'todo',
      pairing: rows.length > 0 && ready === rows.length ? 'done' : 'todo',
    },
    ready,
    total: rows.length,
    rows,
    completedAt: (await getSettings(db)).setupCompletedAt ?? null,
  };
}

export async function completeSetup(app: App, admin: StaffUser) {
  const pr = await setupProgress(app);
  if (pr.total === 0 || pr.ready !== pr.total) throw ApiError.conflict('setup_incomplete', `${pr.ready} dari ${pr.total} kasur siap`);
  await app.db.update('update public.hospital_settings set setup_completed_at = now() where id = 1');
  await audit(app.db, 'superadmin', admin.id, 'setup.complete', null);
  return { completed: true };
}

export async function saveSettings(app: App, admin: StaffUser, r: AgeRanges, escalationRed: number, escalationOrange: number) {
  try {
    await app.db.update(`
      update public.hospital_settings
         set age_min_teen = :a1, age_max_teen = :a2, age_min_adult = :a3, age_max_adult = :a4,
             age_min_elder = :a5, escalation_red_minutes = :er, escalation_orange_minutes = :eo
       where id = 1`, { a1: r.minTeen, a2: r.maxTeen, a3: r.minAdult, a4: r.maxAdult, a5: r.minElder, er: escalationRed, eo: escalationOrange });
  } catch (e) {
    if (isIntegrityViolation(e)) throw ApiError.invalid('bad_age_ranges', 'Rentang umur tumpang tindih atau tidak berurutan');
    throw e;
  }
  const updated = await reapplyPersonas(app, r);
  await audit(app.db, 'superadmin', admin.id, 'settings.update', null, { updatedTablets: updated });
  return { settings: await getSettings(app.db), updatedTablets: updated };
}

async function reapplyPersonas(app: App, ranges: AgeRanges): Promise<number> {
  let n = 0;
  for (const pt of await app.db.list('select id, bed_id, age, persona::text as persona from public.patients')) {
    const next = personaForAge(Number(pt.age), ranges);
    if (next == null || next === pt.persona) continue;
    await app.db.update('update public.patients set persona = cast(:p as persona_key) where id = :id', { p: next, id: pt.id });
    const ctx = await loadBed(app.db, pt.bedId, false);
    const session = tabletSession(ctx);
    if (ctx.tablet && session) app.hub.toTablet(ctx.tablet.id, Events.sessionUpdated(session));
    n++;
  }
  return n;
}

export interface StatsFilter { from: string; to: string; wardId: string | null; levels: string[] }

async function logRows(app: App, f: StatsFilter) {
  const tz = app.cfg.timezone;
  let sql = `
    select id, created_at, level::text as level, status::text as status, source::text as source, escalated,
           ward_id, ward_name, room_number, bed_number, seconds_to_handle, seconds_to_resolve
    from public.alarm_log_anonymous
    where created_at >= cast(:from as timestamptz) and created_at < cast(:to as timestamptz)`;
  if (f.wardId != null) sql += ' and ward_id = :ward';
  if (f.levels.length) sql += ' and level::text in (:levels)';
  sql += ' order by created_at desc limit 5000';
  return app.db.list(sql, { from: startOfLocalDay(tz, f.from), to: startOfLocalDay(tz, addDays(f.to, 1)), ward: f.wardId, levels: f.levels });
}

export async function stats(app: App, f: StatsFilter) {
  const rows = await logRows(app, f);
  const perDay = new Map<string, [number, number]>();
  const perWard = new Map<string, [number, number]>();
  for (const r of rows) {
    const day = localDate(app.cfg.timezone, new Date(r.createdAt));
    const d = perDay.get(day) ?? [0, 0];
    if (r.level === 'red') d[0]++;
    else if (r.level === 'orange') d[1]++;
    perDay.set(day, d);
    if (r.secondsToHandle != null) {
      const w = perWard.get(r.wardName) ?? [0, 0];
      w[0] += Number(r.secondsToHandle);
      w[1]++;
      perWard.set(r.wardName, w);
    }
  }
  const sortKeys = <T>(m: Map<string, T>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    alarmCount: sortKeys(perDay).map(([day, v]) => ({ day, red: v[0], orange: v[1] })),
    responseTime: sortKeys(perWard).map(([ward, v]) => ({ ward, avgSeconds: Math.round(v[0] / v[1]) })),
    log: rows.slice(0, 200),
  };
}

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (s !== '' && '=+-@'.includes(s[0])) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function csv(app: App, f: StatsFilter): Promise<string> {
  const cols = ['createdAt', 'wardName', 'roomNumber', 'bedNumber', 'level', 'status', 'source', 'escalated', 'secondsToHandle', 'secondsToResolve'];
  let out = 'created_at,ward_name,room_number,bed_number,level,status,source,escalated,seconds_to_handle,seconds_to_resolve\n';
  for (const r of await logRows(app, f)) out += `${cols.map((c) => csvCell(r[c])).join(',')}\n`;
  return out;
}
