import { update, uid, getDb, refresh, send } from '../lib/mockDb';
import { api, isLive } from '../lib/supabase';
import { ACTIVE_STATUSES } from '../constants/alarmLevels';

const SOURCE = { red: 'emergency_button', orange: 'call_nurse_button', test: 'nurse_test' };
const pending = [];

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

async function raiseLive(item) {
  try {
    await api('/tablet/alarms', { method: 'POST', body: item });
    return true;
  } catch (e) {
    if (item.level === 'test') return true;
    if (e.status && e.status < 500 && ![404, 408, 429].includes(e.status)) return true;
    return false;
  } finally {
    refresh();
  }
}

let flushing = false;
async function flushPending() {
  if (flushing || !pending.length) return;
  flushing = true;
  try {
    for (const item of [...pending]) {
      if (await raiseLive({ ...item, source: 'offline_queue' })) pending.splice(pending.indexOf(item), 1);
    }
  } finally {
    flushing = false;
  }
}
if (isLive && typeof window !== 'undefined') {
  window.addEventListener('online', flushPending);
  setInterval(flushPending, 5000);
}

export function raiseTestAlarm(testId) {
  if (isLive) return raiseLive({ level: 'test', source: SOURCE.test, clientAlarmId: newId(), testId });
  return Promise.resolve(true);
}

export function activeAlarmsForBed(db, bedId) {
  return db.alarms.filter((a) => a.bedId === bedId && ACTIVE_STATUSES.includes(a.status));
}

export function createAlarm({ bedId, level, summary }) {
  if (isLive) {
    const item = { level, source: SOURCE[level], clientAlarmId: newId() };
    raiseLive(item).then((ok) => {
      if (!ok) pending.push(item);
    });
  }
  return update((db) => {
    const existing = activeAlarmsForBed(db, bedId)[0];
    if (existing) {
      if (level === 'red' && existing.level !== 'red') {
        existing.level = 'red';
        existing.summary = summary;
      }
      return existing.id;
    }
    const bed = db.beds.find((b) => b.id === bedId);
    const room = db.rooms.find((r) => r.id === bed?.roomId);
    const patient = db.patients.find((p) => p.bedId === bedId);
    const id = uid('a');
    db.alarms.push({
      id, bedId, level, status: 'waiting', summary,
      createdAt: Date.now(), patientName: patient?.name || null, wardId: room?.wardId || null,
      handledBy: null, handledAt: null, resolvedAt: null,
    });
    return id;
  });
}

export function handleAlarm(alarmId, userId) {
  update((db) => {
    const a = db.alarms.find((x) => x.id === alarmId);
    if (a && a.status === 'waiting') Object.assign(a, { status: 'handling', handledBy: userId, handledAt: Date.now() });
  });
  if (isLive) send(`/nurse/alarms/${alarmId}/claim`, { method: 'POST' });
}

export function resolveAlarm(alarmId) {
  update((db) => {
    const a = db.alarms.find((x) => x.id === alarmId);
    if (a) Object.assign(a, { status: 'resolved', resolvedAt: Date.now() });
  });
  if (isLive) send(`/nurse/alarms/${alarmId}/resolve`, { method: 'POST' });
}

export function handoverAlarm(alarmId) {
  update((db) => {
    const a = db.alarms.find((x) => x.id === alarmId);
    if (a) Object.assign(a, { status: 'waiting', handledBy: null, handledAt: null });
  });
  if (isLive) send(`/nurse/alarms/${alarmId}/handover`, { method: 'POST' });
}

export function cancelAlarm(alarmId) {
  update((db) => {
    const a = db.alarms.find((x) => x.id === alarmId);
    if (a && a.level !== 'red') Object.assign(a, { status: 'cancelled', resolvedAt: Date.now() });
  });
  if (isLive) send(`/tablet/alarms/${alarmId}/cancel`, { method: 'POST' });
}

export function alarmsToCsv(alarms, db = getDb()) {
  const head = ['waktu', 'bangsal', 'kamar', 'kasur', 'level', 'ringkasan', 'respons_detik'];
  const rows = alarms.map((a) => {
    const bed = db.beds.find((b) => b.id === a.bedId);
    const ward = db.wards.find((w) => w.id === a.wardId);
    const resp = a.resolvedAt ? Math.round((a.resolvedAt - a.createdAt) / 1000) : '';
    return [new Date(a.createdAt).toISOString(), ward?.name || '', bed?.roomId || '', bed?.label || '', a.level, a.summary, resp];
  });
  return [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
