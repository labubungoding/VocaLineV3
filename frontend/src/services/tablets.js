import { update, uid, getDb, send, attempt } from '../lib/mockDb';
import { api, isLive } from '../lib/supabase';

export const DEVICE_ID_PATTERN = /^(TAB|VL)-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function tabletStatus(t, now = Date.now()) {
  if (!t) return 'none';
  if (t.disabled) return 'disabled';
  if (!t.online || now - t.lastSeen > 2 * 60 * 1000) return 'offline';
  if (t.battery < 20) return 'low-battery';
  return 'online';
}

export const STATUS_TEXT = {
  online: 'Online', offline: 'Offline', 'low-battery': 'Baterai rendah', disabled: 'Nonaktif', none: '—',
};
export const STATUS_COLOR = {
  online: '#2a7a43', offline: '#b3261e', 'low-battery': '#d97a0c', disabled: '#6b7a7c', none: '#9fb6b8',
};

export function validateDeviceId(db, deviceId, bedId) {
  const v = deviceId.trim().toUpperCase();
  if (!v) return 'Isi ID perangkat.';
  if (!DEVICE_ID_PATTERN.test(v)) return 'Format ID tidak dikenali. ID tertulis di layar tablet, contoh VL-7K3Q-9MZD.';
  const tablet = db.tablets.find((t) => t.deviceId === v);
  if (tablet?.disabled) return 'Tablet ini dinonaktifkan oleh admin rumah sakit.';
  const usedBed = tablet && db.beds.find((b) => b.tabletId === tablet.id && b.id !== bedId);
  if (usedBed) {
    const room = db.rooms.find((r) => r.id === usedBed.roomId);
    return `Tablet ini sudah terpasang di ${tablet.label} · Kamar ${room?.number} · Kasur ${usedBed.label}. Lepas dulu dari kasur itu, atau pilih tablet lain.`;
  }
  return null;
}

export async function checkDeviceLive(deviceId, bedId) {
  if (!isLive) return null;
  const v = deviceId.trim().toUpperCase();
  try {
    await api(`/nurse/devices/${encodeURIComponent(v)}?bedId=${encodeURIComponent(bedId)}`);
    return null;
  } catch (e) {
    return e.message;
  }
}

export async function pairTablet(deviceId, bedId) {
  const v = deviceId.trim().toUpperCase();
  if (isLive) {
    const db = getDb();
    const current = db.tablets.find((t) => t.id === db.beds.find((b) => b.id === bedId)?.tabletId);
    const mode = current && current.deviceId !== v ? 'replace' : 'pair';
    return attempt('/nurse/tablets/pair', { method: 'POST', body: { deviceCode: v, bedId, mode } });
  }
  update((db) => {
    let tablet = db.tablets.find((t) => t.deviceId === v);
    if (!tablet) {
      const next = db.tablets.length + 1;
      tablet = {
        id: uid('tab'), label: `TAB-${String(next).padStart(2, '0')}`, deviceId: v,
        online: true, battery: 100, lastSeen: Date.now(), disabled: false,
      };
      db.tablets.push(tablet);
    }
    db.beds.forEach((b) => {
      if (b.tabletId === tablet.id) b.tabletId = null;
    });
    const bed = db.beds.find((b) => b.id === bedId);
    if (bed) bed.tabletId = tablet.id;
  });
  return null;
}

export function setTabletDisabled(tabletId, disabled) {
  if (isLive) send(`/admin/tablets/${tabletId}/${disabled ? 'disable' : 'enable'}`, { method: 'POST' });
  update((db) => {
    const t = db.tablets.find((x) => x.id === tabletId);
    if (!t) return;
    t.disabled = disabled;
    if (disabled) db.beds.forEach((b) => { if (b.tabletId === tabletId) b.tabletId = null; });
  });
}

export function heartbeat(deviceId, battery) {
  if (isLive) {
    api('/tablet/heartbeat', { method: 'POST', body: { battery } }).catch(() => {});
    return;
  }
  update((db) => {
    const t = db.tablets.find((x) => x.deviceId === deviceId);
    if (!t) return;
    t.online = true;
    t.lastSeen = Date.now();
    if (typeof battery === 'number') t.battery = battery;
  });
}

export function sendTabletTest(deviceId, type) {
  if (isLive) {
    const db = getDb();
    const tablet = db.tablets.find((t) => t.deviceId === deviceId);
    const bed = tablet && db.beds.find((b) => b.tabletId === tablet.id);
    if (bed) send(`/nurse/beds/${bed.id}/tests`, { method: 'POST', body: { kind: type } });
  }
  update((db) => {
    db.commands = db.commands.filter((c) => c.deviceId !== deviceId);
    db.commands.push({ id: uid('cmd'), deviceId, type, status: 'pending', result: null, createdAt: Date.now() });
  });
}

export function finishTabletTest(commandId, ok, result) {
  if (isLive) {
    send(`/tablet/tests/${commandId}`, { method: 'POST', body: { status: ok ? 'pass' : 'fail', detail: String(result || '').slice(0, 200) } });
  }
  update((db) => {
    const c = db.commands.find((x) => x.id === commandId);
    if (c) Object.assign(c, { status: ok ? 'pass' : 'fail', result, finishedAt: Date.now() });
  });
}
