import { tabletStatus } from '../../../services/tablets';
import { bedShort } from '../../../services/rooms';

export function tabletRows(db) {
  const now = Date.now();
  const rows = db.tablets.map((t) => {
    const bed = db.beds.find((b) => b.tabletId === t.id);
    return { ...t, status: tabletStatus(t, now), bedId: bed?.id || null, bedLabel: bed ? `Kamar ${bedShort(db, bed.id)}` : 'Belum dipasangkan' };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { rows, online: count('online'), offline: count('offline'), lowBattery: count('low-battery') };
}
