const pad = (n) => String(n).padStart(2, '0');

export function formatTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function formatClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${formatClock(ts)}`;
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}m ${pad(s % 60)}d`;
}

export function relativeTime(ts, now = Date.now()) {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

export function toDateInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function partOfDay(ts = Date.now()) {
  const h = new Date(ts).getHours();
  if (h < 11) return 'pagi';
  if (h < 15) return 'siang';
  if (h < 18) return 'sore';
  return 'malam';
}
