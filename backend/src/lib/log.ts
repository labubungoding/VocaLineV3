const FORBIDDEN = ['teks', 'text', 'transcript', 'balasan', 'reply', 'audio', 'riwayat', 'history', 'prompt',
  'diagnosis', 'fullname', 'full_name', 'nickname', 'context', 'password', 'token', 'secret', 'email'];

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;

export function setLogLevel(level: string | undefined) {
  threshold = LEVELS[(level || 'info').toLowerCase()] ?? LEVELS.info;
}

export function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.toLowerCase();
    out[k] = FORBIDDEN.some((f) => key.includes(f)) ? '[disembunyikan]' : v;
  }
  return out;
}

function write(level: string, event: string, fields: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(fields) });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}) => write('debug', event, fields),
  info: (event: string, fields: Record<string, unknown> = {}) => write('info', event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => write('warn', event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => write('error', event, fields),
};
