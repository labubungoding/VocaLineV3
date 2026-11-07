import { getDb } from './mockDb';
import { api, auth, isLive } from './supabase';

export async function signIn({ email, password, role }) {
  if (isLive) return signInLive({ email, password, role });

  await new Promise((r) => setTimeout(r, 300));
  const user = getDb().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || user.password !== password) throw new Error('Email atau kata sandi salah.');
  if (!user.active) throw new Error('Akun ini dinonaktifkan. Hubungi admin rumah sakit.');
  const expected = role === 'superadmin' ? 'superadmin' : 'nurse';
  if (user.role !== expected) throw new Error('Role yang dipilih tidak sesuai dengan akun ini.');
  return { id: user.id, name: user.name, email: user.email, role: user.role, wardId: user.wardId };
}

async function signInLive({ email, password, role }) {
  try {
    await auth.signInWithPassword({ email: email.trim(), password });
  } catch (e) {
    if (e.status === 401) throw new Error('Email atau kata sandi salah.');
    throw new Error(e.status ? e.message : 'Server tidak bisa dihubungi. Coba lagi.');
  }
  let me;
  try {
    me = await api('/auth/me');
  } catch (e) {
    await auth.signOut();
    throw new Error(e.status === 403 ? 'Akun ini dinonaktifkan. Hubungi admin rumah sakit.' : e.message);
  }
  const expected = role === 'superadmin' ? 'superadmin' : 'nurse';
  if (me.role !== expected) {
    await auth.signOut();
    throw new Error('Role yang dipilih tidak sesuai dengan akun ini.');
  }
  return { id: me.id, name: me.fullName, email: me.email, role: me.role, wardId: me.wards?.[0]?.id || null };
}

export function homeFor(user) {
  if (!user) return '/login';
  return user.role === 'superadmin' ? '/admin' : '/nurse';
}
