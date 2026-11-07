import { isLive } from '../../../lib/supabase';

const KEY = 'pp-device-id';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const part = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

export function getDeviceId() {
  if (isLive) {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  }
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `TAB-${part()}-${part()}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `TAB-${part()}-${part()}`;
  }
}
