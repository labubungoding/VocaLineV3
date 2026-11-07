const HONORIFICS = ['pak', 'bu', 'ibu', 'bapak', 'nenek', 'kakek', 'mbak', 'mas', 'oma', 'opa', 'eyang'];

export function callName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1 && HONORIFICS.includes(parts[0].toLowerCase())) return `${parts[0]} ${parts[1]}`;
  return parts[0] || '';
}
