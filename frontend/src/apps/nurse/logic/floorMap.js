import { tabletStatus } from '../../../services/tablets';

export function bedState(db, bed) {
  if (!bed.tabletId) return 'no-tablet';
  const patient = db.patients.find((p) => p.bedId === bed.id);
  if (!patient) return 'empty';
  const active = db.alarms.filter((a) => a.bedId === bed.id && (a.status === 'waiting' || a.status === 'handling'));
  if (active.some((a) => a.status === 'waiting' && a.level === 'red')) return 'red';
  if (active.some((a) => a.status === 'waiting')) return 'orange';
  if (active.some((a) => a.status === 'handling')) return 'handling';
  return 'green';
}

const SUB = { red: 'Darurat', orange: 'Butuh bantuan', handling: 'Ditangani', green: 'Aman', empty: 'Kosong', 'no-tablet': 'Belum ada tablet' };

export function floorRooms(db, wardId) {
  return db.rooms
    .filter((r) => r.wardId === wardId)
    .sort((a, b) => a.number.localeCompare(b.number, 'id', { numeric: true }))
    .map((room) => {
      const beds = db.beds
        .filter((b) => b.roomId === room.id)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((bed) => {
          const state = bedState(db, bed);
          const patient = db.patients.find((p) => p.bedId === bed.id);
          const tablet = db.tablets.find((t) => t.id === bed.tabletId);
          const offline = tablet && tabletStatus(tablet) === 'offline';
          let sub = SUB[state];
          if (state === 'green' && patient) sub = patient.name;
          if (offline && state !== 'no-tablet') sub += ' · tablet offline';
          return { ...bed, state, sub, patient };
        });
      const level = beds.some((b) => b.state === 'red') ? 'red' : beds.some((b) => b.state === 'orange' || b.state === 'handling') ? 'orange' : 'green';
      return { ...room, beds, level };
    });
}
