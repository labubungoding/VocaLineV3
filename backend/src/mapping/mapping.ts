const LEVEL: Record<string, string> = { merah: 'red', oranye: 'orange', hijau: 'green' };
const EMOTION: Record<string, string> = { ceria: 'happy', sedih: 'sad', marah: 'angry', netral: 'neutral' };
const VISUAL: Record<string, string> = { kuning: 'happy', biru: 'sad', tenang: 'neutral', ramah: 'neutral' };
const PERSONA_CLASS: Record<string, string> = { remaja: 'persona-teen', dewasa: 'persona-adult', lansia: 'persona-elder' };
const PERSONA_LABEL: Record<string, string> = { remaja: 'Remaja', dewasa: 'Dewasa', lansia: 'Lansia' };

export const DEVICE_COMMANDS = new Set(['vine_off', 'vine_on', 'volume_turun', 'volume_naik', 'bicara_pelan', 'ulangi', 'diam']);
export const MEAL_TYPES = ['makan_pagi', 'makan_siang', 'makan_malam', 'kunjungan_dokter', 'lainnya'];

export function levelRank(level: string | null | undefined): number {
  switch (level ?? '') {
    case 'red': return 3;
    case 'orange': return 2;
    case 'green': return 1;
    default: return 0;
  }
}

const get = (m: Record<string, string>, k: unknown, d: string) => (typeof k === 'string' && k in m ? m[k] : d);
export const mlLevel = (v: unknown) => get(LEVEL, v, 'green');
export const mlEmotion = (v: unknown) => get(EMOTION, v, 'neutral');
export const mlVisual = (v: unknown) => get(VISUAL, v, 'neutral');
export const personaClass = (p: unknown) => get(PERSONA_CLASS, p, 'persona-adult');
export const personaLabel = (p: unknown) => (typeof p === 'string' && p in PERSONA_LABEL ? PERSONA_LABEL[p] : p);
export const deviceCommand = (c: unknown): string | null => (typeof c === 'string' && DEVICE_COMMANDS.has(c) ? c : null);

export interface AgeRanges { minTeen: number; maxTeen: number; minAdult: number; maxAdult: number; minElder: number }

export function personaForAge(age: number, r: AgeRanges): string | null {
  if (age >= r.minTeen && age <= r.maxTeen) return 'remaja';
  if (age >= r.minAdult && age <= r.maxAdult) return 'dewasa';
  if (age >= r.minElder) return 'lansia';
  return null;
}

const MEAL_FROM_LABEL: Record<string, string> = {
  Sarapan: 'makan_pagi', 'Makan siang': 'makan_siang', 'Makan malam': 'makan_malam', 'Kunjungan dokter': 'kunjungan_dokter',
};
const MEAL_TO_LABEL: Record<string, string> = {
  makan_pagi: 'Sarapan', makan_siang: 'Makan siang', makan_malam: 'Makan malam', kunjungan_dokter: 'Kunjungan dokter', lainnya: 'Lainnya',
};

export function mealFromLabel(label: string | null, extraMessage: string | null): { type: string; extraMessage: string | null } {
  const v = label == null ? '' : label.trim();
  if (MEAL_TYPES.includes(v)) return { type: v, extraMessage };
  if (v in MEAL_FROM_LABEL) return { type: MEAL_FROM_LABEL[v], extraMessage };
  const extra = extraMessage == null || extraMessage.trim() === '' ? v : extraMessage;
  return { type: 'lainnya', extraMessage: extra.trim() === '' ? null : extra };
}

export function mealLabel(type: string, extraMessage: string | null): string {
  if (type === 'lainnya' && extraMessage != null && extraMessage.trim() !== '') return extraMessage;
  return MEAL_TO_LABEL[type] ?? type;
}

export function alarmStatus(status: string): string {
  return status === 'done' ? 'resolved' : status;
}

const VINE = '(?:[vfwbp]h?[ae]?[iy]e?nn?[eao]?|vai|fai|wai)';
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const OFF_WORD = '(?:off|of|op|mati|stop|istirahat|tidur|diam)';
const OFF = new RegExp(
  `${B}(?:turn\\s*off|turn\\s*of|matikan|matiin|nonaktifkan|stop|off)\\s+${VINE}${E}`
  + `|${B}${VINE}\\s*${OFF_WORD}${E}`, 'iu');
const WAKE = new RegExp(`${B}${VINE}${E}`, 'iu');

function clean(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function isOff(text: string | null | undefined): boolean {
  return OFF.test(clean(text));
}

export function isWake(text: string | null | undefined): boolean {
  const t = clean(text);
  return !OFF.test(t) && WAKE.test(t);
}
