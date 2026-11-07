import { parseDatabaseUrl, type PgConfig } from './db/pg.ts';

function str(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`Environment ${name} wajib diisi`);
    return def;
  }
  return v.trim();
}

function int(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment ${name} harus angka`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function duration(name: string, defMs: number): number {
  const v = process.env[name];
  if (!v) return defMs;
  const m = /^(\d+)\s*(ms|s|m)?$/.exec(v.trim());
  if (!m) throw new Error(`Environment ${name} tidak valid (contoh: 25s)`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 'm' ? n * 60_000 : n * 1000;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export interface Config {
  host: string;
  port: number;
  logLevel: string;
  db: PgConfig;
  dbPoolSize: number;
  runMigrations: boolean;
  appUrl: string;
  corsOrigins: string[];
  mlBaseUrl: string;
  mlApiKey: string;
  mlTimeoutMs: number;
  cronSecret: string;
  timezone: string;
  hospitalAdapter: 'mock' | 'http';
  simrsBaseUrl: string;
  simrsApiKey: string;
  maxAudioBytes: number;
  sessionHours: number;
  inviteTokenHours: number;
  resetTokenMinutes: number;
  schedulerEnabled: boolean;
  superadminAllowlist: string[];
  smtp: {
    host: string;
    port: number;
    secure: 'ssl' | 'starttls' | 'none';
    user: string;
    password: string;
    from: string;
    fromName: string;
    rejectUnauthorized: boolean;
    heloName: string;
  };
}

export function loadConfig(): Config {
  const dbUrl = str('DATABASE_URL');
  const appUrl = trimSlash(str('APP_URL', 'http://localhost:8088'));
  const extra = str('EXTRA_CORS_ORIGINS', '').split(',').map((s) => trimSlash(s.trim())).filter(Boolean);
  const secureRaw = str('SMTP_SECURE', '').toLowerCase();
  const smtpPort = int('SMTP_PORT', 587);
  const secure = (secureRaw === 'ssl' || secureRaw === 'starttls' || secureRaw === 'none'
    ? secureRaw : smtpPort === 465 ? 'ssl' : 'starttls') as 'ssl' | 'starttls' | 'none';
  return {
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 8080),
    logLevel: str('LOG_LEVEL', 'info'),
    db: {
      ...parseDatabaseUrl(dbUrl),
      applicationName: 'vocaline-backend',
      connectTimeoutMs: 10_000,
      statementTimeoutMs: int('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
    },
    dbPoolSize: int('DATABASE_POOL_SIZE', 10),
    runMigrations: bool('RUN_MIGRATIONS', true),
    appUrl,
    corsOrigins: [appUrl, ...extra],
    mlBaseUrl: trimSlash(str('ML_BASE_URL', 'http://ml:8000')),
    mlApiKey: str('ML_API_KEY'),
    mlTimeoutMs: duration('ML_TIMEOUT', 25_000),
    cronSecret: str('CRON_SECRET', ''),
    timezone: str('HOSPITAL_TIMEZONE', 'Asia/Jakarta'),
    hospitalAdapter: str('HOSPITAL_ADAPTER', 'mock') === 'http' ? 'http' : 'mock',
    simrsBaseUrl: trimSlash(str('SIMRS_BASE_URL', '')),
    simrsApiKey: str('SIMRS_API_KEY', ''),
    maxAudioBytes: int('MAX_AUDIO_BYTES', 2_500_000),
    sessionHours: int('SESSION_HOURS', 12),
    inviteTokenHours: int('INVITE_TOKEN_HOURS', 24),
    resetTokenMinutes: int('RESET_TOKEN_MINUTES', 60),
    schedulerEnabled: bool('SCHEDULER_ENABLED', true),
    superadminAllowlist: str('SUPERADMIN_ALLOWLIST', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    smtp: {
      host: str('SMTP_HOST', ''),
      port: smtpPort,
      secure,
      user: str('SMTP_USER', ''),
      password: str('SMTP_PASSWORD', ''),
      from: str('MAIL_FROM', ''),
      fromName: str('MAIL_FROM_NAME', 'VocaLine'),
      rejectUnauthorized: bool('SMTP_TLS_REJECT_UNAUTHORIZED', true),
      heloName: str('SMTP_HELO_NAME', 'vocaline.local'),
    },
  };
}

export function setPasswordUrl(cfg: Config): string {
  return `${cfg.appUrl}/auth/set-password`;
}
