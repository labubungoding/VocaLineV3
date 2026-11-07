import { update, uid, send, attempt, getDb } from '../lib/mockDb';
import { isLive } from '../lib/supabase';

function usernameFrom(email) {
  const u = email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30);
  return u.length >= 3 ? u : `${u}${Date.now().toString(36)}`.slice(0, 30);
}

function checkNurse({ name, wardId }) {
  if (!name) return 'Isi nama perawat.';
  if (name.length > 120) return 'Nama maksimal 120 karakter.';
  if (!wardId) return 'Pilih bangsal. Jika belum ada, buat bangsal dulu di halaman Denah.';
  return null;
}

export async function addNurse({ name, email, wardId }) {
  const n = name.trim();
  const e = email.trim().toLowerCase();
  const invalid = checkNurse({ name: n, wardId });
  if (invalid) return invalid;
  if (getDb().users.some((u) => u.email === e)) return 'Email sudah terdaftar.';
  if (isLive) {
    return attempt('/admin/nurses', {
      method: 'POST',
      body: { fullName: n, email: e, username: usernameFrom(e), wardIds: [wardId] },
    });
  }
  update((db) => {
    db.users.push({ id: uid('u'), name: n, email: e, password: 'rahasia123', role: 'nurse', wardId, active: true });
  });
  return null;
}

export async function updateNurse(userId, { name, wardId }) {
  const n = name.trim();
  const invalid = checkNurse({ name: n, wardId });
  if (invalid) return invalid;
  if (isLive) return attempt(`/admin/nurses/${userId}`, { method: 'PATCH', body: { fullName: n, wardIds: [wardId] } });
  update((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u) Object.assign(u, { name: n, wardId });
  });
  return null;
}

export function setUserActive(userId, active) {
  if (isLive) send(`/admin/nurses/${userId}/active`, { method: 'POST', body: { active } });
  update((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u) u.active = active;
  });
}

export async function resetPassword(userId) {
  if (isLive) return attempt(`/admin/nurses/${userId}/reset-password`, { method: 'POST' });
  return null;
}

export function userName(db, userId) {
  return db.users.find((u) => u.id === userId)?.name || '—';
}

export function shortName(name = '') {
  const parts = name.split(' ');
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : name;
}
