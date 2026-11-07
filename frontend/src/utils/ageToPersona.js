export const DEFAULT_AGES = { teenMin: 13, teenMax: 17, adultMin: 18, adultMax: 59, elderMin: 60 };

export function ageToPersona(age, ages = DEFAULT_AGES) {
  const n = Number(age);
  if (!Number.isFinite(n) || age === '' || age === null || age === undefined) return undefined;
  if (n >= ages.teenMin && n <= ages.teenMax) return 'teen';
  if (n >= ages.adultMin && n <= ages.adultMax) return 'adult';
  if (n >= ages.elderMin) return 'elder';
  return null;
}

export function personaLabel(persona, ages = DEFAULT_AGES) {
  if (persona === undefined) return '—';
  if (persona === null) return 'Tidak tersedia';
  return {
    teen: `Remaja (${ages.teenMin}–${ages.teenMax})`,
    adult: `Dewasa (${ages.adultMin}–${ages.adultMax})`,
    elder: `Lansia (${ages.elderMin}+)`,
  }[persona];
}

export function personaShort(persona) {
  return { teen: 'Remaja', adult: 'Dewasa', elder: 'Lansia' }[persona] || '—';
}
