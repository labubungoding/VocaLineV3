import { sortAlarms } from '../../../utils/sortAlarms';

export function alarmQueue(db, wardId, filter = 'all') {
  const bedIds = new Set(db.beds.filter((b) => db.rooms.find((r) => r.id === b.roomId)?.wardId === wardId).map((b) => b.id));
  const active = db.alarms.filter((a) => bedIds.has(a.bedId) && (a.status === 'waiting' || a.status === 'handling'));
  const shown = filter === 'all' ? active : active.filter((a) => a.status === filter);
  return {
    alarms: sortAlarms(shown),
    waitingCount: active.filter((a) => a.status === 'waiting').length,
    allActive: active,
  };
}
