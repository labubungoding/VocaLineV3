import { update, send, attempt } from '../lib/mockDb';
import { isLive } from '../lib/supabase';

const AGE_LIMITS = {
  teenMin: [0, 30, 'Umur minimum remaja'], teenMax: [0, 30, 'Umur maksimum remaja'],
  adultMin: [10, 80, 'Umur minimum dewasa'], adultMax: [10, 100, 'Umur maksimum dewasa'],
  elderMin: [40, 100, 'Umur minimum lansia'],
};
const ESCALATION_LIMITS = { red: [1, 60, 'Batas eskalasi alarm merah'], orange: [1, 120, 'Batas eskalasi alarm oranye'] };

function outOfRange(values, limits) {
  for (const [k, [min, max, label]] of Object.entries(limits)) {
    const v = values[k];
    if (!Number.isInteger(v)) return `${label} harus bilangan bulat.`;
    if (v < min || v > max) return `${label} harus antara ${min} dan ${max}.`;
  }
  return null;
}

export async function saveSettings({ ages, escalation }) {
  const a = Object.fromEntries(Object.entries(ages).map(([k, v]) => [k, v === '' ? NaN : Number(v)]));
  const e = Object.fromEntries(Object.entries(escalation).map(([k, v]) => [k, v === '' ? NaN : Number(v)]));
  const ageError = outOfRange(a, AGE_LIMITS);
  if (ageError) return ageError;
  if (!(a.teenMin <= a.teenMax && a.teenMax < a.adultMin && a.adultMin <= a.adultMax && a.adultMax < a.elderMin)) {
    return 'Rentang umur bertumpuk atau terbalik. Periksa lagi urutannya.';
  }
  const escalationError = outOfRange(e, ESCALATION_LIMITS);
  if (escalationError) return escalationError;
  if (isLive) {
    return attempt('/admin/settings', {
      method: 'PUT',
      body: {
        ageMinTeen: a.teenMin, ageMaxTeen: a.teenMax, ageMinAdult: a.adultMin, ageMaxAdult: a.adultMax,
        ageMinElder: a.elderMin, escalationRed: e.red, escalationOrange: e.orange,
      },
    });
  }
  update((db) => {
    db.settings = { ages: a, escalation: e };
  });
  return null;
}

export function markSetupComplete() {
  if (isLive) send('/admin/setup/complete', { method: 'POST' });
  update((db) => {
    db.setupComplete = true;
  });
}
