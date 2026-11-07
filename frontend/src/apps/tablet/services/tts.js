import { api } from '../../../lib/supabase';

const KEY = 'vl-voice-settings';

export async function loadVoiceSettings() {
  try {
    const s = await api('/tablet/voice-settings');
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
    }
    return s;
  } catch {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      return null;
    }
  }
}
