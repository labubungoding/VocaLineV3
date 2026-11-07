const DAY = 24 * 60 * 60 * 1000;

export function alarmStats(db, { from, to, wardId, levels }) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime() + DAY;
  const list = db.alarms
    .filter((a) => a.createdAt >= start && a.createdAt < end)
    .filter((a) => wardId === 'all' || a.wardId === wardId)
    .filter((a) => levels[a.level])
    .sort((a, b) => b.createdAt - a.createdAt);

  const days = [];
  for (let t = start; t < end && days.length < 31; t += DAY) {
    const inDay = list.filter((a) => a.createdAt >= t && a.createdAt < t + DAY);
    days.push({
      date: new Date(t),
      red: inDay.filter((a) => a.level === 'red').length,
      orange: inDay.filter((a) => a.level === 'orange').length,
    });
  }

  const response = db.wards.map((w) => {
    const done = list.filter((a) => a.wardId === w.id && a.resolvedAt);
    const avg = done.length ? done.reduce((s, a) => s + (a.resolvedAt - a.createdAt), 0) / done.length / 1000 : 0;
    return { wardId: w.id, name: w.name, seconds: avg, count: done.length };
  });

  return { list, days, response, total: list.length };
}
