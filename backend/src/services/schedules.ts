import type { App } from '../app.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import { log } from '../lib/log.ts';
import { MEAL_TYPES, mlVisual } from '../mapping/mapping.ts';
import { Events, speech } from '../realtime/hub.ts';
import { assertWard, audit, loadBed, mlFields } from './core.ts';

export interface ScheduleRow { id: string | null; timeOfDay: string; type: string; isActive: boolean; extraMessage: string | null }

export async function list(app: App, staff: StaffUser, wardId: string, roomId: string | null) {
  assertWard(staff, wardId);
  const scope = roomId == null ? 'room_id is null' : 'room_id = :room';
  return app.db.list(`
    select id, room_id, time_of_day, type::text as type, is_active, extra_message, last_fired_on
    from public.meal_schedules where ward_id = :ward and ${scope}
    order by time_of_day`, { ward: wardId, room: roomId });
}

export async function save(app: App, staff: StaffUser, wardId: string, roomId: string | null, rows: ScheduleRow[]) {
  assertWard(staff, wardId);
  if (roomId != null && await app.db.count('select count(*) from public.rooms where id = :r and ward_id = :w', { r: roomId, w: wardId }) === 0) {
    throw ApiError.notFound('Kamar');
  }
  for (const r of rows) if (!MEAL_TYPES.includes(r.type)) throw ApiError.invalid('validation', 'Jenis jadwal tidak dikenal');
  await app.db.tx(async (t) => {
    const keep = new Set(rows.filter((r) => r.id != null).map((r) => r.id));
    const scope = roomId == null ? 'room_id is null' : 'room_id = :room';
    for (const existing of await t.list(`select id from public.meal_schedules where ward_id = :ward and ${scope}`, { ward: wardId, room: roomId })) {
      if (!keep.has(existing.id)) await t.update('delete from public.meal_schedules where id = :id', { id: existing.id });
    }
    for (const r of rows) {
      const params = { id: r.id, ward: wardId, room: roomId, time: r.timeOfDay, type: r.type, active: r.isActive, msg: r.extraMessage, by: staff.id };
      const n = r.id == null ? 0 : await t.update(`
        update public.meal_schedules
           set time_of_day = cast(:time as time), type = cast(:type as meal_type),
               is_active = :active, extra_message = :msg
         where id = :id and ward_id = :ward`, params);
      if (n === 0) {
        await t.update(`
          insert into public.meal_schedules (ward_id, room_id, time_of_day, type, is_active, extra_message, created_by)
          values (:ward, :room, cast(:time as time), cast(:type as meal_type), :active, :msg, :by)`, params);
      }
    }
  });
  await audit(app.db, 'nurse', staff.id, 'schedule.save', wardId, { rows: rows.length });
  return list(app, staff, wardId, roomId);
}

export async function fireDue(app: App) {
  const db = app.db;
  const due = await db.list('select id, ward_id, room_id, type::text as type, extra_message from public.claim_due_meal_schedules(:tz)',
    { tz: app.cfg.timezone });
  let sent = 0;
  for (const s of due) {
    const scope = s.roomId == null ? '' : ' and b.room_id = :room';
    const occupied = await db.list(`
      select pt.bed_id, b.room_id from public.patients pt join public.beds b on b.id = pt.bed_id
      where pt.ward_id = :ward${scope}`, { ward: s.wardId, room: s.roomId });
    for (const o of occupied) {
      if (s.roomId == null && await db.count(`
        select count(*) from public.meal_schedules
        where room_id = :room and type = cast(:type as meal_type) and is_active`, { room: o.roomId, type: s.type }) > 0) {
        continue;
      }
      const ctx = await loadBed(db, o.bedId, false);
      if (!ctx.tablet || !ctx.patient) continue;
      try {
        const body = { ...mlFields(ctx), jenis: s.type, pesan_tambahan: s.extraMessage ?? '' };
        const r = await app.ml.reminder(body);
        app.hub.toTablet(ctx.tablet.id, Events.reminder(
          speech(r.balasan_teks, mlVisual(r.visual_vine), r.kecepatan_bicara ?? 0, r.balasan_audio ?? null), s.type));
        sent++;
      } catch (e) {
        log.warn('pengingat_gagal', { bed: ctx.bed.code, error: (e as Error).name });
      }
    }
  }
  return { schedules: due.length, sent };
}
