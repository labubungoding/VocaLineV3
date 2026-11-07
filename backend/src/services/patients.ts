import type { App } from '../app.ts';
import { isUniqueViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import type { HospitalPatient } from '../hospital/adapter.ts';
import { log } from '../lib/log.ts';
import { startOfToday } from '../lib/util.ts';
import { mlVisual, personaClass, personaForAge, personaLabel } from '../mapping/mapping.ts';
import { Events, speech } from '../realtime/hub.ts';
import { assertWard, audit, bedLabel, getRanges, getSettings, loadBed, mlFields, rangesOf, tabletSession, type BedContext } from './core.ts';

const blankTo = (v: string | null | undefined, fallback: string) => (v == null || v.trim() === '' ? fallback : v.trim());
const trimOrNull = (v: string | null | undefined) => (v == null ? null : v.trim());

async function findInSimrs(app: App, hospitalPatientId: string): Promise<HospitalPatient> {
  let hp: HospitalPatient | null;
  try {
    hp = await app.hospital.findPatient(hospitalPatientId.trim());
  } catch {
    throw new ApiError(502, 'simrs_unavailable', 'Sistem rumah sakit tidak bisa dihubungi');
  }
  if (!hp) throw ApiError.notFound('Pasien dengan No. RM ini');
  return hp;
}

export async function lookup(app: App, hospitalPatientId: string) {
  const hp = await findInSimrs(app, hospitalPatientId);
  const persona = personaForAge(hp.age, await getRanges(app.db));
  const active = await app.db.one('select bed_id from public.patients where hospital_patient_id = :id', { id: hp.hospitalPatientId });
  return {
    hospitalPatientId: hp.hospitalPatientId,
    fullName: hp.fullName,
    age: hp.age,
    diagnosis: hp.diagnosis,
    persona: persona == null ? null : { key: persona, label: personaLabel(persona), className: personaClass(persona) },
    tooYoung: persona == null,
    alreadyActiveInBed: active ? active.bedId : null,
  };
}

async function greeting(app: App, ctx: BedContext) {
  try {
    const g = await app.ml.greeting(mlFields(ctx));
    return speech(g.balasan_teks, mlVisual(g.visual_vine), g.kecepatan_bicara ?? 0, g.balasan_audio ?? null);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    log.warn('sapaan_ml_gagal', { bed: ctx.bed.code });
    const name = ctx.patient && ctx.patient.nickname.trim() !== '' ? `, ${ctx.patient.nickname}` : '';
    return speech(`Halo${name}. Saya Vine, teman ngobrol selama di sini.`, 'neutral', 1.0, null);
  }
}

export async function activate(app: App, staff: StaffUser, b: {
  bedId: string; hospitalPatientId: string | null; nickname: string; fullName: string | null; age: number | null; diagnosis: string | null;
}) {
  const db = app.db;
  const ctx = await loadBed(db, b.bedId, false);
  assertWard(staff, ctx.bed.wardId);
  if (!ctx.tablet) throw ApiError.conflict('no_tablet', 'Pasangkan tablet ke kasur ini dulu');
  if (ctx.patient) throw ApiError.conflict('bed_occupied', 'Kasur ini sudah terisi');
  let hp: HospitalPatient;
  if (b.hospitalPatientId == null || b.hospitalPatientId.trim() === '') {
    if (b.age == null) throw ApiError.invalid('validation', 'Umur pasien wajib diisi');
    hp = { hospitalPatientId: `MANUAL-${b.bedId}`, fullName: blankTo(b.fullName, b.nickname), age: b.age,
      diagnosis: blankTo(b.diagnosis, '-'), allergies: [], history: [] };
  } else {
    hp = await findInSimrs(app, b.hospitalPatientId);
  }
  const finalAge = b.age != null ? b.age : hp.age;
  const s = await getSettings(db);
  const persona = personaForAge(finalAge, rangesOf(s));
  if (persona == null) throw ApiError.invalid('age_below_minimum', `Pasien di bawah ${s.ageMinTeen} tahun tidak diberi tablet`);
  let patientId: string;
  try {
    patientId = await db.tx(async (t) => {
      const row = await t.one(`
        insert into public.patients (bed_id, ward_id, hospital_patient_id, full_name, nickname, age, diagnosis, persona, activated_by)
        values (:bed, :ward, :rm, :name, :nick, :age, :diag, cast(:persona as persona_key), :by)
        returning id`, {
        bed: b.bedId, ward: ctx.bed.wardId, rm: hp.hospitalPatientId, name: blankTo(b.fullName, hp.fullName),
        nick: b.nickname.trim(), age: finalAge, diag: blankTo(b.diagnosis, hp.diagnosis), persona, by: staff.id,
      });
      await t.update(`
        insert into public.patient_context (patient_id, allergies, history)
        values (:id, array(select jsonb_array_elements_text(cast(:allergies as jsonb))), cast(:history as jsonb))`,
      { id: row!.id, allergies: JSON.stringify(hp.allergies ?? []), history: JSON.stringify(hp.history ?? []) });
      return row!.id as string;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('bed_occupied', 'Kasur ini sudah terisi');
    throw e;
  }
  const fresh = await loadBed(db, b.bedId, false);
  const session = tabletSession(fresh);
  app.hub.toTablet(ctx.tablet.id, Events.activated(session, await greeting(app, fresh)));
  await audit(db, 'nurse', staff.id, 'patient.activate', patientId, { bedId: b.bedId, persona });
  return { patientId, persona, personaClass: personaClass(persona), bedState: 'green' };
}

export async function update(app: App, staff: StaffUser, patientId: string, b: {
  nickname: string | null; age: number | null; diagnosis: string | null; fullName: string | null;
}) {
  const db = app.db;
  const p = await db.one('select id, bed_id, ward_id from public.patients where id = :id', { id: patientId });
  if (!p) throw ApiError.notFound('Pasien');
  assertWard(staff, p.wardId);
  let persona: string | null = null;
  if (b.age != null) {
    persona = personaForAge(b.age, await getRanges(db));
    if (persona == null) throw ApiError.invalid('age_below_minimum', 'Umur di bawah batas minimum');
  }
  await db.update(`
    update public.patients
       set nickname = coalesce(:nick, nickname),
           full_name = coalesce(:name, full_name),
           diagnosis = coalesce(:diag, diagnosis),
           age = coalesce(:age, age),
           persona = coalesce(cast(:persona as persona_key), persona)
     where id = :id`, {
    nick: trimOrNull(b.nickname), name: trimOrNull(b.fullName), diag: trimOrNull(b.diagnosis), age: b.age, persona, id: patientId,
  });
  const ctx = await loadBed(db, p.bedId, false);
  const session = tabletSession(ctx);
  if (ctx.tablet && session) app.hub.toTablet(ctx.tablet.id, Events.sessionUpdated(session));
  await audit(db, 'nurse', staff.id, 'patient.update', patientId);
  return { patientId, session };
}

export async function discharge(app: App, staff: StaffUser, patientId: string) {
  const db = app.db;
  const p = await db.one('select id, bed_id, ward_id from public.patients where id = :id', { id: patientId });
  if (!p) throw ApiError.notFound('Pasien');
  assertWard(staff, p.wardId);
  const bedId = p.bedId as string;
  const ctx = await loadBed(db, bedId, false);
  await db.tx(async (t) => {
    await t.update(`update public.alarms set status = 'done', resolved_by = :n, resolved_at = now()
      where patient_id = :p and status in ('waiting','handling')`, { n: staff.id, p: patientId });
    await t.update('update public.alarms set summary = null where patient_id = :p', { p: patientId });
    await t.update('delete from public.patients where id = :p', { p: patientId });
    if (ctx.tablet) await t.update('update public.tablets set ai_enabled = true where id = :t', { t: ctx.tablet.id });
  });
  try {
    await app.ml.resetSession(ctx.bed.code);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    log.warn('reset_sesi_ml_gagal', { bed: ctx.bed.code });
  }
  if (ctx.tablet) app.hub.toTablet(ctx.tablet.id, Events.sessionEnded());
  await audit(db, 'nurse', staff.id, 'patient.discharge', patientId, { bedId });
  return { bedId, bedState: 'empty' };
}

export async function bedDetail(app: App, staff: StaffUser, bedId: string) {
  const db = app.db;
  const ctx = await loadBed(db, bedId, false);
  assertWard(staff, ctx.bed.wardId);
  const patient = await db.one(`
    select id, full_name, nickname, age, diagnosis, persona::text as persona, activated_at
    from public.patients where bed_id = :b`, { b: bedId });
  if (patient) patient.personaClass = personaClass(patient.persona);
  const tablet = await db.one(`
    select id, device_code, label, status::text as status, battery_level, is_charging, ai_enabled, last_seen_at
    from public.tablets where bed_id = :b`, { b: bedId });
  const alarms = await db.list(`
    select a.id, a.level::text as level, a.status::text as status, a.summary, a.created_at,
           a.handled_at, a.resolved_at, h.full_name as handler_name
    from public.alarms a
    left join public.profiles h on h.id = a.handled_by
    where a.bed_id = :b and a.created_at >= cast(:since as timestamptz)
    order by a.created_at desc`, { b: bedId, since: startOfToday(app.cfg.timezone) });
  return {
    bed: { id: ctx.bed.id, code: ctx.bed.code, number: ctx.bed.number, roomNumber: ctx.bed.roomNumber,
      wardId: ctx.bed.wardId, wardName: ctx.bed.wardName, label: bedLabel(ctx.bed) },
    patient: patient ?? null,
    tablet: tablet ?? null,
    alarmsToday: alarms,
  };
}
