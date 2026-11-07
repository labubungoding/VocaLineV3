const LEVEL_RANK = { red: 0, orange: 1, test: 2 };
const STATUS_RANK = { waiting: 0, handling: 1 };

export function sortAlarms(alarms) {
  return [...alarms].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) ||
      a.createdAt - b.createdAt,
  );
}

export function isEscalated(alarm, settings, now = Date.now()) {
  if (alarm.status !== 'waiting') return false;
  const limitMin = settings?.escalation?.[alarm.level];
  return Boolean(limitMin) && now - alarm.createdAt > limitMin * 60 * 1000;
}
