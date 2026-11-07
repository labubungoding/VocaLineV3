import { auth, isLive } from '../lib/supabase';

const KEY = 'pp-session';

export function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function setUser(next) {
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
  }
}

export function logout() {
  setUser(null);
  if (isLive) auth.signOut();
}
