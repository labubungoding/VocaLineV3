import type { App } from '../app.ts';
import { ApiError } from '../http/errors.ts';
import { HANDLED, Reply, type Ctx, type Router, type StaffUser, type TabletIdentity } from '../http/router.ts';
import { parseBody, v } from '../http/validate.ts';
import { uuidOrNull, uuidPath } from '../lib/util.ts';
import { mealFromLabel } from '../mapping/mapping.ts';
import * as auth from '../auth/service.ts';
import * as admin from '../services/admin.ts';
import * as alarms from '../services/alarms.ts';
import * as conversation from '../services/conversation.ts';
import * as layout from '../services/layout.ts';
import * as patients from '../services/patients.ts';
import * as schedules from '../services/schedules.ts';
import * as snapshot from '../services/snapshot.ts';
import * as staffSvc from '../services/staff.ts';
import * as tablets from '../services/tablets.ts';
import { getSettings } from '../services/core.ts';
import { assertWard } from '../services/core.ts';
import { log } from '../lib/log.ts';

const PUBLIC = { kind: 'public' } as const;
const CRON = { kind: 'cron' } as const;
const TABLET = { kind: 'tablet' } as const;
const TABLET_ANY = { kind: 'tablet', allowUnregistered: true } as const;
const STAFF = { kind: 'staff' } as const;
const NURSE = { kind: 'staff', roles: ['nurse'] } as const;
const SUPER = { kind: 'staff', roles: ['superadmin'] } as const;

const staff = (c: Ctx) => c.staff as StaffUser;
const tablet = (c: Ctx) => c.tablet as TabletIdentity;
const created = (body: unknown) => new Reply(201, body);
const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const S = {
  superadminRequest: v.obj({ email: v.str({ notBlank: true, email: true }) }),
  login: v.obj({ email: v.str({ notBlank: true, max: 200 }), password: v.str({ required: true, max: 200 }) }),
  token: v.obj({ token: v.str({ notBlank: true, max: 200 }) }),
  setPassword: v.obj({ token: v.str({ notBlank: true, max: 200 }), password: v.str({ required: true, max: 200 }) }),
  forgot: v.obj({ email: v.str({ notBlank: true, email: true, max: 200 }) }),
  changePassword: v.obj({ currentPassword: v.str({ required: true, max: 200 }), newPassword: v.str({ required: true, max: 200 }) }),
  register: v.obj({ appVersion: v.str({ max: 40 }) }),
  heartbeat: v.obj({ battery: v.int({ min: 0, max: 100 }), charging: v.bool(), aiEnabled: v.bool(), appVersion: v.str({ max: 40 }) }),
  utterance: v.obj({ audio: v.str({ notBlank: true, min: 100 }), retryCount: v.int({ min: 0, max: 5 }) }),
  tabletAlarm: v.obj({
    level: v.str({ notBlank: true, pattern: /^(red|orange|test)$/ }),
    source: v.str({ notBlank: true, pattern: /^(emergency_button|call_nurse_button|nurse_test|offline_queue)$/ }),
    clientAlarmId: v.uuid({ required: true }),
    testId: v.uuid(),
  }),
  aiToggle: v.obj({ enabled: v.bool({ required: true }) }),
  testResult: v.obj({ status: v.str({ notBlank: true, pattern: /^(pass|fail)$/ }), detail: v.str({ max: 200 }) }),
  patientLookup: v.obj({ hospitalPatientId: v.str({ notBlank: true, max: 40 }) }),
  activatePatient: v.obj({
    bedId: v.uuid({ required: true }),
    hospitalPatientId: v.str({ max: 40 }),
    nickname: v.str({ notBlank: true, max: 30 }),
    fullName: v.str({ min: 1, max: 120 }),
    age: v.int({ min: 0, max: 130 }),
    diagnosis: v.str({ min: 1, max: 200 }),
  }),
  updatePatient: v.obj({
    nickname: v.str({ min: 1, max: 30 }), fullName: v.str({ min: 1, max: 120 }),
    age: v.int({ min: 0, max: 130 }), diagnosis: v.str({ min: 1, max: 200 }),
  }),
  tabletTest: v.obj({ kind: v.str({ notBlank: true, pattern: /^(mic|speaker|alarm)$/ }) }),
  pairTablet: v.obj({ deviceCode: v.str({ notBlank: true, min: 4, max: 20 }), bedId: v.uuid({ required: true }), mode: v.str({ pattern: /^(pair|replace)$/ }) }),
  saveSchedules: v.obj({
    rows: v.list(v.obj({
      id: v.str(),
      timeOfDay: v.str({ notBlank: true, pattern: TIME }),
      type: v.str({ notBlank: true }),
      isActive: v.bool({ required: true }),
      extraMessage: v.str({ max: 200 }),
    }), { required: true, max: 20 }),
  }),
  ward: v.obj({ name: v.str({ notBlank: true, max: 60 }), floorLabel: v.str({ max: 40 }) }),
  wardPatch: v.obj({ name: v.str({ min: 1, max: 60 }), floorLabel: v.str({ max: 40 }) }),
  room: v.obj({ wardId: v.uuid({ required: true }), number: v.str({ notBlank: true, max: 20 }) }),
  roomPatch: v.obj({ number: v.str({ notBlank: true, max: 20 }) }),
  bed: v.obj({ roomId: v.uuid({ required: true }), number: v.str({ notBlank: true, max: 10 }) }),
  createNurse: v.obj({
    fullName: v.str({ notBlank: true, max: 120 }),
    email: v.str({ notBlank: true, email: true }),
    username: v.str({ notBlank: true, pattern: USERNAME }),
    wardIds: v.list(v.uuid({ required: true }), { required: true, min: 1 }),
  }),
  updateNurse: v.obj({
    fullName: v.str({ min: 1, max: 120 }),
    username: v.str({ pattern: USERNAME }),
    wardIds: v.list(v.uuid({ required: true }), { min: 1 }),
  }),
  nurseActive: v.obj({ active: v.bool({ required: true }) }),
  settings: v.obj({
    ageMinTeen: v.int({ required: true, min: 0, max: 30 }),
    ageMaxTeen: v.int({ required: true, min: 0, max: 30 }),
    ageMinAdult: v.int({ required: true, min: 10, max: 80 }),
    ageMaxAdult: v.int({ required: true, min: 10, max: 100 }),
    ageMinElder: v.int({ required: true, min: 40, max: 100 }),
    escalationRed: v.int({ required: true, min: 1, max: 60 }),
    escalationOrange: v.int({ required: true, min: 1, max: 120 }),
  }),
};

const TABLET_FILTERS = new Set(['online', 'offline', 'low-battery']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function statsFilter(c: Ctx): admin.StatsFilter {
  const from = c.query.get('from');
  const to = c.query.get('to');
  if (from == null || to == null) throw ApiError.invalid('validation', 'Data tidak valid');
  if (!validDate(from) || !validDate(to)) throw ApiError.invalid('validation', 'Format tanggal harus YYYY-MM-DD');
  if (to < from) throw ApiError.invalid('validation', 'Tanggal akhir sebelum tanggal awal');
  const levels = c.query.get('levels');
  const lv = levels == null ? [] : levels.split(',').map((l) => l.trim()).filter((l) => l === 'red' || l === 'orange');
  return { from, to, wardId: uuidOrNull(c.query.get('wardId')), levels: lv };
}

export function registerRoutes(r: Router, app: App) {
  r.get('/api/health', PUBLIC, async () => {
    let database = false;
    try {
      database = (await app.db.count('select count(*) from public.hospital_settings')) >= 0;
    } catch { database = false; }
    let mlOk = false;
    try {
      const h = await app.ml.health();
      mlOk = h != null && h.status === 'ok';
    } catch { mlOk = false; }
    return new Reply(database ? 200 : 503, { status: database ? 'ok' : 'degraded', database, mlService: { ok: mlOk } });
  });

  r.post('/api/auth/superadmin/request', PUBLIC, async (c) => {
    app.rate.check(`sa:${c.ip}`, 5, 15 * 60_000);
    const b = parseBody(S.superadminRequest, await c.body());
    return new Reply(202, await staffSvc.requestSuperadminAccess(app, b.email!));
  });
  r.get('/api/auth/me', STAFF, (c) => staffSvc.me(app, staff(c)));
  r.post('/api/auth/login', PUBLIC, async (c) => {
    const b = parseBody(S.login, await c.body());
    return auth.login(app, b.email!, b.password!, c.ip, c.userAgent);
  });
  r.post('/api/auth/logout', STAFF, (c) => auth.logout(app, staff(c)));
  r.post('/api/auth/password/check', PUBLIC, async (c) => {
    const b = parseBody(S.token, await c.body());
    return auth.checkLinkToken(app, b.token, c.ip);
  });
  r.post('/api/auth/password/set', PUBLIC, async (c) => {
    const b = parseBody(S.setPassword, await c.body());
    return auth.setPasswordWithToken(app, b.token, b.password, c.ip);
  });
  r.post('/api/auth/password/forgot', PUBLIC, async (c) => {
    const b = parseBody(S.forgot, await c.body());
    return new Reply(202, await auth.forgotPassword(app, b.email!, c.ip));
  });
  r.post('/api/auth/password/change', STAFF, async (c) => {
    const b = parseBody(S.changePassword, await c.body());
    return auth.changePassword(app, staff(c), b.currentPassword, b.newPassword);
  });

  r.get('/api/events', { kind: 'public' }, async (c) => {
    const token = auth.bearer(c.req.headers.authorization) ?? null;
    let client: Parameters<typeof app.hub.add>[0];
    if (token?.startsWith(auth.STAFF_TOKEN_PREFIX)) {
      const s = await auth.resolveStaff(app, token);
      client = { kind: 'staff', res: c.res, userId: s.id, sessionId: s.sessionId, role: s.role, wardIds: s.wardIds };
    } else if (token?.startsWith(tablets.TABLET_TOKEN_PREFIX)) {
      const t = await auth.resolveTablet(app, token);
      if (!t?.id) throw ApiError.unauthorized();
      client = { kind: 'tablet', res: c.res, tabletId: t.id };
    } else {
      throw ApiError.unauthorized();
    }
    c.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    c.res.write('retry: 3000\n\nevent: ready\ndata: {"type":"ready"}\n\n');
    app.hub.add(client);
    return HANDLED;
  });

  r.get('/api/compat/snapshot', STAFF, (c) => snapshot.forStaff(app, staff(c)));
  r.get('/api/compat/tablet-snapshot', TABLET_ANY, (c) => snapshot.forTablet(app, tablet(c)));

  r.post('/api/cron/reminders', CRON, () => schedules.fireDue(app));
  r.post('/api/cron/ml-health', CRON, () => recordMlHealth(app));

  r.post('/api/tablet/register', PUBLIC, async (c) => {
    let t: TabletIdentity | null = null;
    try {
      t = await auth.resolveTablet(app, auth.bearer(c.req.headers.authorization));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
    }
    t ??= { id: null, deviceCode: null, bedId: null };
    if (!t.id) app.rate.check(`register:${c.ip}`, 60, 10 * 60_000);
    const raw = await c.body();
    const b = raw === undefined ? { appVersion: null } : parseBody(S.register, raw);
    return created(await tablets.register(app, t.id ? t : null, b.appVersion));
  });
  r.get('/api/tablet/state', TABLET, (c) => tablets.state(app, tablet(c)));
  r.get('/api/tablet/voice-settings', TABLET, () => app.ml.voiceSettings());
  r.post('/api/tablet/heartbeat', TABLET, async (c) => {
    const b = parseBody(S.heartbeat, await c.body());
    return tablets.heartbeat(app, tablet(c), b);
  });
  r.post('/api/tablet/utterance', TABLET, async (c) => {
    const t = tablet(c);
    app.rate.check(`utt:${t.id}`, 30, 60_000);
    const b = parseBody(S.utterance, await c.body());
    if (Math.floor(b.audio!.length * 0.75) > app.cfg.maxAudioBytes) throw ApiError.invalid('audio_too_large', 'Ucapan terlalu panjang');
    return conversation.handleUtterance(app, t, b.audio!, b.retryCount ?? 0);
  });
  r.post('/api/tablet/alarms', TABLET, async (c) => {
    const t = tablet(c);
    const b = parseBody(S.tabletAlarm, await c.body());
    if (t.bedId == null) throw ApiError.conflict('not_paired', 'Tablet belum dipasangkan');
    const res = await alarms.raiseForBed(app, t.bedId, t.id, b.level!, b.source!, b.clientAlarmId);
    if (b.level === 'test' && b.testId) await tablets.markAlarmTestPassed(app, t, b.testId);
    return new Reply(res.created ? 201 : 200, { alarm: alarms.brief(res.alarm), created: res.created });
  });
  r.post('/api/tablet/alarms/:id/cancel', TABLET, (c) => alarms.cancelFromTablet(app, uuidPath(c.params.id, 'Alarm'), tablet(c).id));
  r.post('/api/tablet/ai', TABLET, async (c) => {
    const b = parseBody(S.aiToggle, await c.body());
    return tablets.setAi(app, tablet(c), b.enabled!);
  });
  r.post('/api/tablet/tests/:id', TABLET, async (c) => {
    const id = uuidPath(c.params.id, 'Tes');
    const b = parseBody(S.testResult, await c.body());
    return tablets.reportTest(app, tablet(c), id, b.status!, b.detail);
  });

  r.get('/api/nurse/wards', NURSE, (c) => layout.listWards(app, staff(c)));
  r.get('/api/nurse/wards/:wardId/map', NURSE, (c) => {
    const w = uuidPath(c.params.wardId, 'Bangsal');
    assertWard(staff(c), w);
    return layout.wardMap(app, w, true);
  });
  r.get('/api/nurse/wards/:wardId/alarms', NURSE, (c) => {
    const w = uuidPath(c.params.wardId, 'Bangsal');
    assertWard(staff(c), w);
    return alarms.wardQueue(app, w, c.query.get('status') ?? 'all');
  });
  r.post('/api/nurse/alarms/:id/claim', NURSE, (c) => alarms.claim(app, uuidPath(c.params.id, 'Alarm'), staff(c)));
  r.post('/api/nurse/alarms/:id/resolve', NURSE, (c) => alarms.resolve(app, uuidPath(c.params.id, 'Alarm'), staff(c)));
  r.post('/api/nurse/alarms/:id/handover', NURSE, (c) => alarms.handover(app, uuidPath(c.params.id, 'Alarm'), staff(c)));
  r.get('/api/nurse/shift/open-alarms', NURSE, (c) => alarms.openAlarmsOf(app, staff(c)));
  r.post('/api/nurse/patients/lookup', NURSE, async (c) => {
    const b = parseBody(S.patientLookup, await c.body());
    return patients.lookup(app, b.hospitalPatientId!);
  });
  r.post('/api/nurse/patients', NURSE, async (c) => {
    const b = parseBody(S.activatePatient, await c.body());
    return created(await patients.activate(app, staff(c), {
      bedId: b.bedId!, hospitalPatientId: b.hospitalPatientId, nickname: b.nickname!, fullName: b.fullName, age: b.age, diagnosis: b.diagnosis,
    }));
  });
  r.patch('/api/nurse/patients/:id', NURSE, async (c) => {
    const id = uuidPath(c.params.id, 'Pasien');
    const b = parseBody(S.updatePatient, await c.body());
    return patients.update(app, staff(c), id, b);
  });
  r.delete('/api/nurse/patients/:id', NURSE, (c) => patients.discharge(app, staff(c), uuidPath(c.params.id, 'Pasien')));
  r.get('/api/nurse/beds/:bedId', NURSE, (c) => patients.bedDetail(app, staff(c), uuidPath(c.params.bedId, 'Kasur')));
  r.post('/api/nurse/beds/:bedId/tests', NURSE, async (c) => {
    const bedId = uuidPath(c.params.bedId, 'Kasur');
    const b = parseBody(S.tabletTest, await c.body());
    return created(await tablets.requestTest(app, staff(c), bedId, b.kind!));
  });
  r.get('/api/nurse/devices/:code', NURSE, (c) => {
    const bedId = c.query.get('bedId');
    if (bedId == null) throw ApiError.invalid('validation', 'Data tidak valid');
    return tablets.lookupDevice(app, c.params.code, uuidPath(bedId, 'Kasur'));
  });
  r.post('/api/nurse/tablets/pair', NURSE, async (c) => {
    const b = parseBody(S.pairTablet, await c.body());
    return tablets.pair(app, staff(c), b.deviceCode!, b.bedId!, b.mode ?? 'pair');
  });
  r.get('/api/nurse/wards/:wardId/schedules', NURSE, (c) =>
    schedules.list(app, staff(c), uuidPath(c.params.wardId, 'Bangsal'), uuidOrNull(c.query.get('roomId'))));
  r.put('/api/nurse/wards/:wardId/schedules', NURSE, async (c) => {
    const b = parseBody(S.saveSchedules, await c.body());
    const rows = b.rows!.map((row) => {
      const meal = mealFromLabel(row.type, row.extraMessage);
      const id = row.id != null && /^[0-9a-f-]{36}$/i.test(row.id.trim()) ? row.id.trim().toLowerCase() : null;
      return { id, timeOfDay: row.timeOfDay!, type: meal.type, isActive: row.isActive!, extraMessage: meal.extraMessage };
    });
    return schedules.save(app, staff(c), uuidPath(c.params.wardId, 'Bangsal'), uuidOrNull(c.query.get('roomId')), rows);
  });

  r.get('/api/admin/setup', SUPER, () => admin.setupProgress(app));
  r.post('/api/admin/setup/complete', SUPER, (c) => admin.completeSetup(app, staff(c)));
  r.get('/api/admin/overview', SUPER, () => admin.overview(app));
  r.get('/api/admin/tablets', SUPER, (c) => {
    const status = c.query.get('status');
    if (status != null && !TABLET_FILTERS.has(status)) throw ApiError.invalid('validation', 'Filter status tidak dikenal');
    return tablets.list(app, status);
  });
  r.post('/api/admin/tablets/:id/disable', SUPER, (c) => tablets.disable(app, staff(c), uuidPath(c.params.id, 'Tablet')));
  r.post('/api/admin/tablets/:id/enable', SUPER, (c) => tablets.enable(app, staff(c), uuidPath(c.params.id, 'Tablet')));
  r.get('/api/admin/wards', SUPER, (c) => layout.listWards(app, staff(c)));
  r.get('/api/admin/wards/:id/map', SUPER, (c) => layout.wardMap(app, uuidPath(c.params.id, 'Bangsal'), false));
  r.post('/api/admin/wards', SUPER, async (c) => {
    const b = parseBody(S.ward, await c.body());
    return created(await layout.createWard(app, staff(c), b.name!, b.floorLabel));
  });
  r.patch('/api/admin/wards/:id', SUPER, async (c) => {
    const id = uuidPath(c.params.id, 'Bangsal');
    const b = parseBody(S.wardPatch, await c.body());
    return layout.updateWard(app, staff(c), id, b.name, b.floorLabel);
  });
  r.post('/api/admin/rooms', SUPER, async (c) => {
    const b = parseBody(S.room, await c.body());
    return created(await layout.createRoom(app, staff(c), b.wardId!, b.number!));
  });
  r.patch('/api/admin/rooms/:id', SUPER, async (c) => {
    const id = uuidPath(c.params.id, 'Kamar');
    const b = parseBody(S.roomPatch, await c.body());
    return layout.updateRoom(app, staff(c), id, b.number!);
  });
  r.post('/api/admin/beds', SUPER, async (c) => {
    const b = parseBody(S.bed, await c.body());
    return created(await layout.createBed(app, staff(c), b.roomId!, b.number!));
  });
  r.delete('/api/admin/layout/:type/:id', SUPER, (c) =>
    layout.remove(app, staff(c), c.params.type, uuidPath(c.params.id, c.params.type)));
  r.get('/api/admin/nurses', SUPER, (c) => {
    const q = c.query.get('q');
    return staffSvc.listNurses(app, q == null ? null : q.slice(0, 60));
  });
  r.post('/api/admin/nurses', SUPER, async (c) => {
    const b = parseBody(S.createNurse, await c.body());
    return created(await staffSvc.createNurse(app, staff(c), { fullName: b.fullName!, email: b.email!, username: b.username!, wardIds: b.wardIds as string[] }));
  });
  r.patch('/api/admin/nurses/:id', SUPER, async (c) => {
    const id = uuidPath(c.params.id, 'Akun perawat');
    const b = parseBody(S.updateNurse, await c.body());
    return staffSvc.updateNurse(app, staff(c), id, { ...b, wardIds: b.wardIds as string[] | null });
  });
  r.post('/api/admin/nurses/:id/active', SUPER, async (c) => {
    const id = uuidPath(c.params.id, 'Akun perawat');
    const b = parseBody(S.nurseActive, await c.body());
    return staffSvc.setActive(app, staff(c), id, b.active!);
  });
  r.post('/api/admin/nurses/:id/reset-password', SUPER, (c) => staffSvc.sendPasswordReset(app, staff(c), uuidPath(c.params.id, 'Akun')));
  r.get('/api/admin/settings', SUPER, () => getSettings(app.db));
  r.put('/api/admin/settings', SUPER, async (c) => {
    const b = parseBody(S.settings, await c.body());
    return admin.saveSettings(app, staff(c), {
      minTeen: b.ageMinTeen!, maxTeen: b.ageMaxTeen!, minAdult: b.ageMinAdult!, maxAdult: b.ageMaxAdult!, minElder: b.ageMinElder!,
    }, b.escalationRed!, b.escalationOrange!);
  });
  r.get('/api/admin/stats', SUPER, (c) => admin.stats(app, statsFilter(c)));
  r.get('/api/admin/stats.csv', SUPER, async (c) => {
    const f = statsFilter(c);
    const body = await admin.csv(app, f);
    return new Reply(200, body, {
      'Content-Type': 'text/csv;charset=UTF-8',
      'Content-Disposition': `attachment; filename="log-alarm_${f.from}_${f.to}.csv"`,
    }, true);
  });
}

export async function recordMlHealth(app: App) {
  let ok = false;
  let detail: unknown;
  try {
    const h = await app.ml.health();
    ok = h != null && h.status === 'ok';
    detail = h == null ? {} : (h.komponen ?? null);
  } catch (e) {
    detail = { error: (e as Error).name };
  }
  await app.db.update(`
    insert into public.service_status (name, ok, detail, checked_at)
    values ('ml-service', :ok, cast(:detail as jsonb), now())
    on conflict (name) do update set ok = excluded.ok, detail = excluded.detail, checked_at = excluded.checked_at`,
  { ok, detail: JSON.stringify(detail ?? null) });
  if (!ok) log.warn('ml_service_tidak_sehat', {});
  return { ok };
}
