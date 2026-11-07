import type { App } from '../app.ts';
import { isUniqueViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser, TabletIdentity } from '../http/router.ts';
import { newDeviceCode, normalizeDeviceCode } from '../lib/util.ts';
import { Events } from '../realtime/hub.ts';
import { hashToken, newToken } from '../auth/password.ts';
import { assertWard, audit, bedLabel, getSettings, loadBed, tabletSession } from './core.ts';

export const TABLET_TOKEN_PREFIX = 'vlt_';

export async function register(app: App, existing: TabletIdentity | null, appVersion: string | null) {
  if (existing?.id) return { tabletId: existing.id, deviceCode: existing.deviceCode };
  for (let i = 0; i < 5; i++) {
    const token = newToken(TABLET_TOKEN_PREFIX);
    try {
      const row = await app.db.one(`
        insert into public.tablets (device_code, device_token_hash, app_version, last_seen_at, status)
        values (:code, :hash, :v, now(), 'online')
        returning id, device_code`, { code: newDeviceCode(), hash: hashToken(token), v: appVersion });
      return { tabletId: row!.id, deviceCode: row!.deviceCode, deviceToken: token };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error('Gagal membuat kode perangkat unik');
}

export async function state(app: App, t: TabletIdentity) {
  if (t.bedId == null) return { deviceCode: t.deviceCode, stage: 'setup', bedLabel: null, session: null, openAlarm: null };
  const ctx = await loadBed(app.db, t.bedId, false);
  const session = tabletSession(ctx);
  const openAlarm = await app.db.one(`
    select id, level::text as level, status::text as status from public.alarms
    where bed_id = :bed and status in ('waiting','handling') and level <> 'test'
    order by created_at desc limit 1`, { bed: t.bedId });
  return { deviceCode: t.deviceCode, stage: session == null ? 'standby' : 'active', bedLabel: bedLabel(ctx.bed), session, openAlarm };
}

export async function heartbeat(app: App, t: TabletIdentity, b: { battery: number | null; charging: boolean | null; aiEnabled: boolean | null; appVersion: string | null }) {
  const lowPct = Number((await getSettings(app.db)).lowBatteryPercent);
  const low = b.battery != null && b.battery <= lowPct && b.charging !== true;
  await app.db.update(`
    update public.tablets
       set last_seen_at = now(),
           status = cast(:status as tablet_status),
           battery_level = coalesce(:battery, battery_level),
           is_charging = coalesce(:charging, is_charging),
           ai_enabled = coalesce(:ai, ai_enabled),
           app_version = coalesce(:version, app_version)
     where id = :id`, {
    status: low ? 'low-battery' : 'online', battery: b.battery, charging: b.charging, ai: b.aiEnabled, version: b.appVersion, id: t.id,
  });
  return { ok: true, serverTime: new Date().toISOString() };
}

export async function setAi(app: App, t: TabletIdentity, enabled: boolean) {
  await app.db.update('update public.tablets set ai_enabled = :e where id = :id', { e: enabled, id: t.id });
  return { aiEnabled: enabled };
}

export async function reportTest(app: App, t: TabletIdentity, testId: string, status: string, detail: string | null) {
  const n = await app.db.update(`
    update public.tablet_tests set status = cast(:s as test_status), detail = :d, finished_at = now()
    where id = :id and tablet_id = :t`, { s: status, d: detail, id: testId, t: t.id });
  if (n === 0) throw ApiError.notFound('Tes');
  if (t.bedId) {
    const ctx = await loadBed(app.db, t.bedId, false);
    app.hub.toWard(ctx.bed.wardId, Events.testResult(testId, t.id!, status, detail));
  }
  return { id: testId, status };
}

export async function markAlarmTestPassed(app: App, t: TabletIdentity, testId: string) {
  await app.db.update("update public.tablet_tests set status = 'pass', finished_at = now() where id = :id and tablet_id = :t",
    { id: testId, t: t.id });
}

export async function lookupDevice(app: App, rawCode: string, bedId: string) {
  const code = normalizeDeviceCode(rawCode);
  if (code == null) throw ApiError.invalid('bad_device_code', 'Format ID perangkat salah. Contoh: VL-7K3Q-9MZD');
  const t = await app.db.one('select id, device_code, bed_id, disabled_at from public.tablets where device_code = :c', { c: code });
  if (!t) throw ApiError.notFound('Tablet dengan ID ini. Pastikan layar "Tablet belum terpasang" sedang terbuka');
  if (t.disabledAt != null) throw ApiError.conflict('tablet_disabled', 'Tablet ini sudah dinonaktifkan superadmin');
  const currentBed = t.bedId as string | null;
  if (currentBed != null && currentBed !== bedId) throw ApiError.conflict('tablet_in_use', 'Tablet sudah terpasang di kasur lain');
  return { tabletId: t.id, deviceCode: t.deviceCode, isNew: currentBed == null };
}

export async function pair(app: App, staff: StaffUser, deviceCode: string, bedId: string, mode: string) {
  const db = app.db;
  const ctx = await loadBed(db, bedId, false);
  assertWard(staff, ctx.bed.wardId);
  const found = await lookupDevice(app, deviceCode, bedId);
  const tabletId = found.tabletId as string;
  if (ctx.tablet && ctx.tablet.id !== tabletId) {
    if (mode !== 'replace') throw ApiError.conflict('bed_has_tablet', 'Kasur ini sudah punya tablet. Gunakan Ganti tablet');
    await db.update('update public.tablets set bed_id = null, paired_at = null where id = :id', { id: ctx.tablet.id });
    app.hub.toTablet(ctx.tablet.id, Events.unpaired());
  }
  try {
    await db.update('update public.tablets set bed_id = :bed, paired_at = now(), paired_by = :by, label = :label where id = :id', {
      bed: bedId, by: staff.id, label: `${ctx.bed.wardName} ${ctx.bed.roomNumber}-${ctx.bed.number}`, id: tabletId,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('bed_has_tablet', 'Kasur ini sudah punya tablet');
    throw e;
  }
  const fresh = await loadBed(db, bedId, false);
  app.hub.toTablet(tabletId, Events.paired(bedId, bedLabel(fresh.bed)));
  const session = tabletSession(fresh);
  if (session) app.hub.toTablet(tabletId, Events.sessionUpdated(session));
  await audit(db, 'nurse', staff.id, mode === 'replace' ? 'tablet.replace' : 'tablet.pair', tabletId, { bedId });
  return { tabletId, bedId, bedState: session == null ? 'empty' : 'green' };
}

export async function requestTest(app: App, staff: StaffUser, bedId: string, kind: string) {
  const ctx = await loadBed(app.db, bedId, false);
  assertWard(staff, ctx.bed.wardId);
  if (!ctx.tablet) throw ApiError.conflict('no_tablet', 'Kasur ini belum punya tablet');
  const test = (await app.db.one(`
    insert into public.tablet_tests (tablet_id, kind, requested_by)
    values (:t, cast(:k as test_kind), :by)
    returning id, kind::text as kind, status::text as status`, { t: ctx.tablet.id, k: kind, by: staff.id }))!;
  app.hub.toTablet(ctx.tablet.id, Events.test(test.id, kind));
  return test;
}

export async function list(app: App, status: string | null) {
  const filter = status == null ? '' : ' and t.status = cast(:s as tablet_status)';
  return app.db.list(`
    select t.id, t.label, t.device_code, t.status::text as status, t.battery_level, t.is_charging,
           t.ai_enabled, t.last_seen_at, t.app_version, t.disabled_at,
           b.id as bed_id, b.number as bed_number, b.code as bed_code,
           r.number as room_number, w.name as ward_name
    from public.tablets t
    left join public.beds b on b.id = t.bed_id
    left join public.rooms r on r.id = b.room_id
    left join public.wards w on w.id = r.ward_id
    where t.paired_at is not null${filter}
    order by t.label`, { s: status });
}

export async function disable(app: App, staff: StaffUser, tabletId: string) {
  const n = await app.db.update("update public.tablets set disabled_at = now(), bed_id = null, status = 'offline' where id = :id", { id: tabletId });
  if (n === 0) throw ApiError.notFound('Tablet');
  app.hub.toTablet(tabletId, Events.unpaired());
  await audit(app.db, 'superadmin', staff.id, 'tablet.disable', tabletId);
  return { id: tabletId, disabled: true };
}

export async function enable(app: App, staff: StaffUser, tabletId: string) {
  const n = await app.db.update('update public.tablets set disabled_at = null where id = :id', { id: tabletId });
  if (n === 0) throw ApiError.notFound('Tablet');
  app.hub.toTablet(tabletId, Events.unpaired());
  await audit(app.db, 'superadmin', staff.id, 'tablet.enable', tabletId);
  return { id: tabletId, disabled: false };
}
