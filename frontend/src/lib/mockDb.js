import { api, auth, ensureTabletRegistered, isLive, isTabletPage } from './supabase';
import { showToast } from '../components/ui/toast';

const KEY = 'pp-db-v1';
const listeners = new Set();
const channel = !isLive && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pp-db') : null;

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

function seed() {
  const now = Date.now();
  const min = 60 * 1000;
  const day = 24 * 60 * min;

  const wards = [
    { id: 'melati', name: 'Melati' },
    { id: 'mawar', name: 'Mawar' },
  ];
  const rooms = ['101', '102', '103', '104', '105', '106'].map((n) => ({ id: n, wardId: 'melati', number: n }));
  rooms.push({ id: '203', wardId: 'mawar', number: '203' });

  const devices = [
    'TAB-2K9A-11PL', 'TAB-8H2D-40XQ', 'TAB-3B6F-21KM', 'TAB-1C7E-55RW', 'TAB-6M3P-07TY', 'TAB-4N8S-62VA',
    'TAB-5R1T-38HE', 'TAB-7W2U-94GJ', 'TAB-2X5Y-16CN', 'TAB-9D3Z-71FB', 'TAB-9Q4L-88ZB', 'TAB-3J6K-45MD',
  ];
  const tablets = devices.map((deviceId, i) => ({
    id: `tab-${String(i + 1).padStart(2, '0')}`,
    label: `TAB-${String(i + 1).padStart(2, '0')}`,
    deviceId,
    online: i !== 3,
    battery: [91, 77, 64, 38, 12, 85, 70, 66, 93, 58, 80, 75][i],
    lastSeen: i === 3 ? now - 24 * min : now,
    disabled: false,
  }));

  const bedIds = ['101a', '101b', '102a', '102b', '103a', '103b', '104a', '104b', '105a', '105b', '106a', '106b'];
  const beds = bedIds.map((id, i) => ({
    id,
    roomId: id.slice(0, 3),
    label: id.slice(3).toUpperCase(),
    tabletId: id === '104b' ? null : tablets[i].id,
  }));
  beds.push({ id: '203a', roomId: '203', label: 'A', tabletId: null });

  const p = (bedId, name, age, diagnosis, daysAgo) => ({
    id: `pt-${bedId}`, bedId, name, age, diagnosis, admittedAt: now - daysAgo * day,
  });
  const patients = [
    p('101a', 'Pak Harjo', 72, 'Gagal jantung', 3),
    p('101b', 'Pak Darto', 65, 'Diabetes', 2),
    p('102a', 'Bu Wati', 38, 'Tifus', 1),
    p('103a', 'Raka', 16, 'Demam berdarah', 2),
    p('103b', 'Mbak Lia', 27, 'Gastritis', 1),
    p('105a', 'Pak Yusuf', 51, 'Pneumonia', 4),
    p('105b', 'Bu Rina Kartika', 45, 'Pascaoperasi usus buntu', 2),
    p('106a', 'Nenek Sumi', 80, 'Patah tulang pinggul', 5),
    p('106b', 'Dimas', 14, 'Asma', 1),
  ];

  const a = (id, bedId, level, status, summary, agoMin, extra = {}) => ({
    id, bedId, level, status, summary, createdAt: now - agoMin * min,
    patientName: patients.find((x) => x.bedId === bedId)?.name || null,
    wardId: 'melati', handledBy: null, handledAt: null, resolvedAt: null, ...extra,
  });
  const alarms = [
    a('a1041', '101a', 'red', 'waiting', 'Dada saya nyeri banget', 1.2),
    a('a1042', '105b', 'orange', 'waiting', 'Infusnya sudah habis', 3.7),
    a('a1039', '103a', 'orange', 'handling', 'Mau ke toilet', 6.1, { handledBy: 'u1', handledAt: now - 4 * min }),
  ];
  const summaries = ['Infus habis', 'Nyeri dada', 'Minta ke toilet', 'Sesak napas', 'Minta minum', 'Nyeri bekas operasi'];
  for (let d = 0; d < 7; d++) {
    const count = 4 + ((d * 5) % 7);
    for (let k = 0; k < count; k++) {
      const red = (d + k) % 5 === 0;
      const created = now - d * day - (k + 1) * 47 * min;
      const resp = (red ? 50 : 120) + ((k * 37) % 120);
      alarms.push({
        id: `h-${d}-${k}`, bedId: bedIds[(d + k) % bedIds.length], level: red ? 'red' : 'orange',
        status: 'resolved', summary: summaries[(d + k) % summaries.length], createdAt: created,
        patientName: null, wardId: k % 4 === 3 ? 'mawar' : 'melati', handledBy: 'u2',
        handledAt: created + 30 * 1000, resolvedAt: created + resp * 1000,
      });
    }
  }

  return {
    version: 1,
    wards, rooms, beds, tablets, patients, alarms,
    schedules: [
      { id: 's1', scope: 'ward', wardId: 'melati', roomId: null, time: '07:00', type: 'Sarapan', active: true },
      { id: 's2', scope: 'ward', wardId: 'melati', roomId: null, time: '12:00', type: 'Makan siang', active: true },
      { id: 's3', scope: 'ward', wardId: 'melati', roomId: null, time: '18:00', type: 'Makan malam', active: true },
    ],
    users: [
      { id: 'u0', name: 'Admin RS', email: 'admin@rumahsakit.id', password: 'admin123', role: 'superadmin', wardId: null, active: true },
      { id: 'u1', name: 'Sari Wulandari', email: 'sari@rumahsakit.id', password: 'rahasia123', role: 'nurse', wardId: 'melati', active: true },
      { id: 'u2', name: 'Dewi Lestari', email: 'dewi@rumahsakit.id', password: 'rahasia123', role: 'nurse', wardId: 'melati', active: true },
      { id: 'u3', name: 'Andi Pratama', email: 'andi@rumahsakit.id', password: 'rahasia123', role: 'nurse', wardId: 'melati', active: true },
      { id: 'u4', name: 'Rudi Hartono', email: 'rudi@rumahsakit.id', password: 'rahasia123', role: 'nurse', wardId: 'melati', active: false },
    ],
    settings: {
      ages: { teenMin: 13, teenMax: 17, adultMin: 18, adultMax: 59, elderMin: 60 },
      escalation: { red: 1, orange: 5 },
    },
    commands: [],
    setupComplete: false,
  };
}

function emptyDb() {
  return {
    version: 1, wards: [], rooms: [], beds: [], tablets: [], patients: [], alarms: [], schedules: [], users: [],
    settings: {
      ages: { teenMin: 13, teenMax: 17, adultMin: 18, adultMax: 59, elderMin: 60 },
      escalation: { red: 1, orange: 5 },
    },
    commands: [], setupComplete: false,
  };
}

function load() {
  if (isLive) return emptyDb();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
  }
  return seed();
}

let state = load();

function persist() {
  if (isLive) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function reloadFromStorage() {
  state = load();
  emit();
}

if (channel) channel.onmessage = reloadFromStorage;
if (!isLive && typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) reloadFromStorage();
  });
}

export function getDb() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function update(fn) {
  const next = structuredClone(state);
  const result = fn(next);
  state = next;
  persist();
  emit();
  channel?.postMessage('changed');
  return result;
}

let inflight = null;
let again = false;

export function refresh() {
  if (!isLive) return Promise.resolve();
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      const data = await api(isTabletPage ? '/compat/tablet-snapshot' : '/compat/snapshot');
      if (data) {
        state = data;
        emit();
      }
    } catch (e) {
      if (!isTabletPage && (e.status === 401 || e.status === 403)) {
        try {
          sessionStorage.removeItem('pp-session');
        } catch {
        }
        if (!/^\/(login|403|auth\/)/.test(window.location.pathname)) window.location.replace('/login');
      }
    } finally {
      inflight = null;
      if (again) {
        again = false;
        refresh();
      }
    }
  })();
  return inflight;
}

export async function remote(path, options) {
  try {
    return await api(path, options);
  } finally {
    refresh();
  }
}

export function send(path, options) {
  return remote(path, options).catch((e) => {
    showToast(e.message, 'error', 6000);
    return null;
  });
}

export async function attempt(path, options) {
  try {
    await remote(path, options);
    return null;
  } catch (e) {
    return e.message || 'Gagal menyimpan. Coba lagi.';
  }
}

async function initialLoad() {
  if (isTabletPage) {
    try {
      const code = await ensureTabletRegistered();
      if (code) localStorage.setItem('pp-device-id', code);
    } catch {
    }
    return refresh();
  }
  if (auth.hasSession()) return refresh();
  return null;
}

if (isLive && typeof window !== 'undefined') {
  await Promise.race([initialLoad(), new Promise((r) => setTimeout(r, 8000))]);
}

export function resetDb() {
  state = seed();
  persist();
  emit();
  channel?.postMessage('changed');
}

if (typeof window !== 'undefined') window.ppResetDb = resetDb;
