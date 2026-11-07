import type { App } from '../app.ts';
import type { Db, Row } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import { log } from '../lib/log.ts';
import { personaClass, type AgeRanges } from '../mapping/mapping.ts';
import type { StaffUser } from '../http/router.ts';

export async function audit(db: Db, actorKind: string, actorId: string | null, action: string, target: string | null,
  meta: Record<string, unknown> = {}) {
  try {
    await db.update(`
      insert into public.audit_log (actor_kind, actor_id, action, target, meta)
      values (:kind, :actor, :action, :target, cast(:meta as jsonb))`,
    { kind: actorKind, actor: actorId, action, target, meta: JSON.stringify(meta ?? {}) });
  } catch {
    log.warn('audit_gagal', { action });
  }
}

export async function getSettings(db: Db): Promise<Row> {
  const s = await db.one('select * from public.hospital_settings where id = 1');
  if (!s) throw new Error('hospital_settings belum ada (jalankan migrasi)');
  return s;
}

export function rangesOf(s: Row): AgeRanges {
  return { minTeen: s.ageMinTeen, maxTeen: s.ageMaxTeen, minAdult: s.ageMinAdult, maxAdult: s.ageMaxAdult, minElder: s.ageMinElder };
}

export async function getRanges(db: Db): Promise<AgeRanges> {
  return rangesOf(await getSettings(db));
}

export interface Bed { id: string; code: string; number: string; roomNumber: string; wardId: string; wardName: string }
export interface TabletRef { id: string; aiEnabled: boolean }
export interface PatientRef { id: string; nickname: string; age: number; persona: string; diagnosis: string }
export interface BedContext { bed: Bed; tablet: TabletRef | null; patient: PatientRef | null; context: Record<string, unknown> | null }

export const bedLabel = (b: Bed) => `Kamar ${b.roomNumber} · Kasur ${b.number}`;

export async function loadBed(db: Db, bedId: string, withMedical: boolean): Promise<BedContext> {
  const b = await db.one(`
    select b.id, b.code, b.number, r.number as room_number, r.ward_id, w.name as ward_name
    from public.beds b
    join public.rooms r on r.id = b.room_id
    join public.wards w on w.id = r.ward_id
    where b.id = :id`, { id: bedId });
  if (!b) throw ApiError.notFound('Kasur');
  const bed: Bed = { id: b.id, code: b.code, number: b.number, roomNumber: b.roomNumber, wardId: b.wardId, wardName: b.wardName };
  const t = await db.one('select id, ai_enabled from public.tablets where bed_id = :id and disabled_at is null', { id: bedId });
  const tablet = t ? { id: t.id as string, aiEnabled: t.aiEnabled === true } : null;
  const p = await db.one(
    'select id, nickname, age, persona::text as persona, diagnosis from public.patients where bed_id = :id', { id: bedId });
  const patient = p ? { id: p.id, nickname: p.nickname, age: Number(p.age), persona: p.persona, diagnosis: p.diagnosis } : null;
  let context: Record<string, unknown> | null = null;
  if (withMedical && patient) {
    const pc = (await db.one(
      'select allergies, history, preferences from public.patient_context where patient_id = :id', { id: patient.id })) ?? {};
    context = {
      diagnosis: patient.diagnosis,
      alergi: pc.allergies ?? [],
      riwayat: pc.history ?? [],
      preferensi: pc.preferences ?? {},
    };
  }
  return { bed, tablet, patient, context };
}

export function mlFields(ctx: BedContext): Record<string, unknown> {
  return {
    id_kasur: ctx.bed.code,
    umur: ctx.patient ? ctx.patient.age : null,
    nama_panggilan: ctx.patient ? ctx.patient.nickname : '',
    persona: ctx.patient ? ctx.patient.persona : null,
  };
}

export function tabletSession(ctx: BedContext): Record<string, unknown> | null {
  if (!ctx.patient) return null;
  return {
    patientId: ctx.patient.id,
    nickname: ctx.patient.nickname,
    personaClass: personaClass(ctx.patient.persona),
    bedLabel: bedLabel(ctx.bed),
    aiEnabled: ctx.tablet == null || ctx.tablet.aiEnabled,
  };
}

export function assertWard(staff: StaffUser, wardId: string) {
  if (staff.role === 'nurse' && !staff.wardIds.includes(wardId)) {
    throw ApiError.forbidden('Bangsal ini bukan tanggung jawab Anda');
  }
}

export type { App };
