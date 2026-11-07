import { update, send } from '../lib/mockDb';
import { isLive } from '../lib/supabase';

export function saveSchedules({ wardId, scope, roomId, rows }) {
  if (isLive) {
    const query = scope === 'room' && roomId ? `?roomId=${roomId}` : '';
    send(`/nurse/wards/${wardId}/schedules${query}`, {
      method: 'PUT',
      body: { rows: rows.map((r) => ({ id: r.id, timeOfDay: r.time, type: r.type, isActive: Boolean(r.active) })) },
    });
  }
  update((db) => {
    db.schedules = db.schedules.filter((s) =>
      scope === 'ward' ? !(s.scope === 'ward' && s.wardId === wardId) : !(s.scope === 'room' && s.roomId === roomId),
    );
    rows.forEach((r) => db.schedules.push({ ...r, scope, wardId, roomId: scope === 'room' ? roomId : null }));
  });
}

export function schedulesForRoom(db, roomId) {
  const room = db.rooms.find((r) => r.id === roomId);
  const own = db.schedules.filter((s) => s.scope === 'room' && s.roomId === roomId);
  if (own.length) return own;
  return db.schedules.filter((s) => s.scope === 'ward' && s.wardId === room?.wardId);
}
