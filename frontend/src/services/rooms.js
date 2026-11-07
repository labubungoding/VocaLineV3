import { update, uid, getDb, remote, send } from '../lib/mockDb';
import { isLive } from '../lib/supabase';
import { showToast } from '../components/ui/toast';

async function deleteLive(items) {
  try {
    for (const [type, id] of items) await remote(`/admin/layout/${type}/${id}`, { method: 'DELETE' });
  } catch (e) {
    showToast(e.message, 'error', 6000);
  }
}

const bedOccupied = (db, bedId) => db.patients.some((p) => p.bedId === bedId);

export function addWard(name) {
  if (isLive) send('/admin/wards', { method: 'POST', body: { name: name.trim() } });
  update((db) => {
    db.wards.push({ id: uid('w'), name: name.trim() });
  });
}

export function renameWard(wardId, name) {
  if (isLive) send(`/admin/wards/${wardId}`, { method: 'PATCH', body: { name: name.trim() } });
  update((db) => {
    const w = db.wards.find((x) => x.id === wardId);
    if (w) w.name = name.trim();
  });
}

export function deleteWard(wardId) {
  const before = getDb();
  return update((db) => {
    const roomIds = db.rooms.filter((r) => r.wardId === wardId).map((r) => r.id);
    const busy = db.beds.some((b) => roomIds.includes(b.roomId) && bedOccupied(db, b.id));
    if (busy) return 'Bangsal masih punya kasur yang dipakai pasien.';
    if (isLive) {
      const beds = before.beds.filter((b) => roomIds.includes(b.roomId)).map((b) => ['bed', b.id]);
      deleteLive([...beds, ...roomIds.map((id) => ['room', id]), ['ward', wardId]]);
    }
    db.beds = db.beds.filter((b) => !roomIds.includes(b.roomId));
    db.rooms = db.rooms.filter((r) => r.wardId !== wardId);
    db.wards = db.wards.filter((w) => w.id !== wardId);
    return null;
  });
}

export function addRoom(wardId, number) {
  return update((db) => {
    const n = number.trim();
    if (db.rooms.some((r) => r.number === n)) return 'Nomor kamar sudah dipakai.';
    if (isLive) send('/admin/rooms', { method: 'POST', body: { wardId, number: n } });
    const id = n.toLowerCase().replace(/[^a-z0-9]/g, '') || uid('r');
    db.rooms.push({ id, wardId, number: n });
    return null;
  });
}

export function renameRoom(roomId, number) {
  if (isLive) send(`/admin/rooms/${roomId}`, { method: 'PATCH', body: { number: number.trim() } });
  update((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (r) r.number = number.trim();
  });
}

export function deleteRoom(roomId) {
  return update((db) => {
    if (db.beds.some((b) => b.roomId === roomId && bedOccupied(db, b.id))) return 'Kamar masih dipakai pasien.';
    if (isLive) deleteLive([...db.beds.filter((b) => b.roomId === roomId).map((b) => ['bed', b.id]), ['room', roomId]]);
    db.beds = db.beds.filter((b) => b.roomId !== roomId);
    db.rooms = db.rooms.filter((r) => r.id !== roomId);
    return null;
  });
}

export function addBed(roomId, label) {
  return update((db) => {
    const l = label.trim().toUpperCase();
    if (db.beds.some((b) => b.roomId === roomId && b.label === l)) return 'Kasur dengan nomor itu sudah ada.';
    if (isLive) send('/admin/beds', { method: 'POST', body: { roomId, number: l } });
    db.beds.push({ id: `${roomId}${l.toLowerCase()}`, roomId, label: l, tabletId: null });
    return null;
  });
}

export function deleteBed(bedId) {
  return update((db) => {
    if (bedOccupied(db, bedId)) return 'Kasur sedang dipakai pasien.';
    if (isLive) deleteLive([['bed', bedId]]);
    db.beds = db.beds.filter((b) => b.id !== bedId);
    return null;
  });
}

export function bedName(db, bedId) {
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) return '—';
  const room = db.rooms.find((r) => r.id === bed.roomId);
  return `Kamar ${room?.number ?? bed.roomId} · Kasur ${bed.label}`;
}

export function bedShort(db, bedId) {
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) return '—';
  const room = db.rooms.find((r) => r.id === bed.roomId);
  return `${room?.number ?? bed.roomId} · ${bed.label}`;
}
