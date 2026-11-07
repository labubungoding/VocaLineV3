export const isTabletPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/tablet');

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export const isLive = Boolean(API_URL);
export const isSupabaseReady = isLive;

const STAFF_KEY = 'vl-staff-auth';
const TABLET_KEY = 'vl-tablet-auth';

function store() {
  if (typeof window === 'undefined') return null;
  return isTabletPage ? window.localStorage : window.sessionStorage;
}

export function getToken() {
  try {
    const raw = store()?.getItem(isTabletPage ? TABLET_KEY : STAFF_KEY);
    if (!raw) return null;
    return /^vl[st]_[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    const s = store();
    const key = isTabletPage ? TABLET_KEY : STAFF_KEY;
    if (token) s?.setItem(key, token);
    else s?.removeItem(key);
  } catch {
  }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const t = token === undefined ? getToken() : token;
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Server tidak bisa dihubungi (${res.status})`);
    err.status = res.status;
    err.code = json?.error?.code;
    err.details = json?.error?.details;
    throw err;
  }
  return json;
}

export const auth = {
  async signInWithPassword({ email, password }) {
    const res = await api('/auth/login', { method: 'POST', body: { email, password }, token: null });
    setToken(res.accessToken);
    return res;
  },
  async signOut() {
    const t = getToken();
    setToken(null);
    if (t) await api('/auth/logout', { method: 'POST', token: t }).catch(() => {});
  },
  hasSession() {
    return Boolean(getToken());
  },
};

export async function ensureTabletRegistered() {
  const res = await api('/tablet/register', { method: 'POST', body: { appVersion: 'web-1' } });
  if (res?.deviceToken) setToken(res.deviceToken);
  return res?.deviceCode || null;
}
