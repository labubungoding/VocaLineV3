import type { App } from '../app.ts';
import { isIntegrityViolation, isUniqueViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import { bedCode } from '../lib/util.ts';
import { audit } from './core.ts';

const RANK: Record<string, number> = { red: 4, orange: 3, handling: 2, green: 1 };

export async function listWards(app: App, staff: StaffUser) {
  if (staff.role !== 'superadmin' && staff.wardIds.length === 0) return [];
  const filter = staff.role === 'superadmin' ? '' : ' where w.id in (:ids)';
  return app.db.list(`
    select w.id, w.name, w.floor_label, count(r.id) as room_count
    from public.wards w left join public.rooms r on r.ward_id = w.id${filter}
    group by w.id order by w.name`, { ids: staff.wardIds });
}

export async function wardMap(app: App, wardId: string, includePatients: boolean) {
  const db = app.db;
  const ward = await db.one('select id, name, floor_label from public.wards where id = :w', { w: wardId });
  if (!ward) throw ApiError.notFound('Bangsal');
  const rooms = await db.list('select id, number, sort_order from public.rooms where ward_id = :w order by sort_order, number', { w: wardId });
  const bedRows = await db.list(`
    select s.bed_id, s.bed_number, s.bed_code, s.room_id, s.tablet_id, s.tablet_status::text as tablet_status,
           s.ai_enabled, s.bed_state, t.device_code
    from public.bed_states s
    left join public.tablets t on t.id = s.tablet_id
    where s.ward_id = :w
    order by s.bed_number`, { w: wardId });
  const patientsByBed = new Map<string, unknown>();
  if (includePatients) {
    for (const p of await db.list(`
      select id, bed_id, full_name, nickname, age, diagnosis, persona::text as persona
      from public.patients where ward_id = :w`, { w: wardId })) patientsByBed.set(p.bedId, p);
  }
  const outRooms = rooms.map((r) => {
    let top = 'green';
    const beds = bedRows.filter((b) => b.roomId === r.id).map((b) => {
      const bed: Record<string, unknown> = {
        id: b.bedId, number: b.bedNumber, code: b.bedCode, tabletId: b.tabletId,
        deviceCode: b.deviceCode,
        tabletStatus: b.tabletStatus, aiEnabled: b.aiEnabled,
      };
      if (includePatients) {
        const st = b.bedState as string;
        bed.bedState = st;
        bed.patient = patientsByBed.get(b.bedId) ?? null;
        if ((RANK[st] ?? 0) > (RANK[top] ?? 0)) top = st;
      }
      return bed;
    });
    beds.sort((a, b) => (String(a.number) < String(b.number) ? -1 : String(a.number) > String(b.number) ? 1 : 0));
    const room: Record<string, unknown> = { id: r.id, number: r.number };
    if (includePatients) room.level = top === 'handling' ? 'orange' : top;
    room.beds = beds;
    return room;
  });
  return { ward, rooms: outRooms };
}

export async function createWard(app: App, admin: StaffUser, name: string, floorLabel: string | null) {
  try {
    const w = await app.db.one('insert into public.wards (name, floor_label) values (:n, :f) returning id, name, floor_label',
      { n: name.trim(), f: floorLabel });
    await audit(app.db, 'superadmin', admin.id, 'ward.create', w!.id);
    return w;
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('ward_exists', 'Nama bangsal sudah ada');
    throw e;
  }
}

export async function updateWard(app: App, admin: StaffUser, id: string, name: string | null, floorLabel: string | null) {
  try {
    const w = await app.db.one(`
      update public.wards set name = coalesce(:n, name), floor_label = coalesce(:f, floor_label)
      where id = :id returning id, name, floor_label`, { n: name == null ? null : name.trim(), f: floorLabel, id });
    if (!w) throw ApiError.notFound('Bangsal');
    await audit(app.db, 'superadmin', admin.id, 'ward.update', id);
    return w;
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('ward_exists', 'Nama bangsal sudah ada');
    throw e;
  }
}

export async function createRoom(app: App, admin: StaffUser, wardId: string, number: string) {
  try {
    const r = await app.db.one(`
      insert into public.rooms (ward_id, number, sort_order)
      values (:w, :n, (select coalesce(max(sort_order), 0) + 1 from public.rooms where ward_id = :w))
      returning id, ward_id, number, sort_order`, { w: wardId, n: number.trim() });
    await audit(app.db, 'superadmin', admin.id, 'room.create', r!.id);
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('room_exists', 'Nomor kamar sudah ada di bangsal ini');
    if (isIntegrityViolation(e)) throw ApiError.notFound('Bangsal');
    throw e;
  }
}

export async function updateRoom(app: App, admin: StaffUser, id: string, number: string) {
  try {
    const r = await app.db.one('update public.rooms set number = :n where id = :id returning id, ward_id, number', { n: number.trim(), id });
    if (!r) throw ApiError.notFound('Kamar');
    await audit(app.db, 'superadmin', admin.id, 'room.update', id);
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('room_exists', 'Nomor kamar sudah ada di bangsal ini');
    throw e;
  }
}

export async function createBed(app: App, admin: StaffUser, roomId: string, number: string) {
  const room = await app.db.one(`
    select r.number, w.name as ward_name from public.rooms r join public.wards w on w.id = r.ward_id
    where r.id = :id`, { id: roomId });
  if (!room) throw ApiError.notFound('Kamar');
  const code = bedCode(room.wardName, room.number, number.trim());
  try {
    const b = await app.db.one('insert into public.beds (room_id, number, code) values (:r, :n, :c) returning id, room_id, number, code',
      { r: roomId, n: number.trim(), c: code });
    await audit(app.db, 'superadmin', admin.id, 'bed.create', b!.id);
    return b;
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('bed_exists', 'Nomor kasur sudah ada di kamar ini');
    throw e;
  }
}

export async function remove(app: App, admin: StaffUser, type: string, id: string) {
  const table = type === 'ward' ? 'wards' : type === 'room' ? 'rooms' : type === 'bed' ? 'beds' : null;
  if (!table) throw ApiError.invalid('validation', 'type harus ward, room, atau bed');
  if (type === 'bed') {
    if (await app.db.count('select count(*) from public.patients where bed_id = :id', { id }) > 0) {
      throw ApiError.conflict('bed_occupied', 'Kasur sedang terisi pasien');
    }
    await app.db.update('update public.tablets set bed_id = null where bed_id = :id', { id });
  }
  try {
    const n = await app.db.update(`delete from public.${table} where id = :id`, { id });
    if (n === 0) throw ApiError.notFound(type);
  } catch (e) {
    if (isIntegrityViolation(e)) throw ApiError.conflict('not_empty', 'Masih ada isi atau riwayat alarm. Kosongkan dulu');
    throw e;
  }
  await audit(app.db, 'superadmin', admin.id, `${type}.delete`, id);
  return { id, deleted: true };
}
