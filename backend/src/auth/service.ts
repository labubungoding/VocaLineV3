import type { App } from '../app.ts';
import type { Db } from '../db/db.ts';
import { setPasswordUrl } from '../config.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser, TabletIdentity } from '../http/router.ts';
import { log } from '../lib/log.ts';
import { burnTime, hashPassword, hashToken, isLegacyBcrypt, newToken, validateNewPassword, verifyPassword } from './password.ts';
import { TABLET_TOKEN_PREFIX } from '../services/tablets.ts';

export const STAFF_TOKEN_PREFIX = 'vls_';
const LINK_TOKEN_PREFIX = 'vli_';
const MAX_SESSION_DAYS = 7;
const LOCK_AFTER_FAILS = 10;
const LOCK_MINUTES = 15;

export function bearer(header: string | undefined): string | null {
  if (!header || !/^bearer /i.test(header) || header.length <= 7) return null;
  return header.slice(7).trim() || null;
}

export async function resolveStaff(app: App, token: string | null): Promise<StaffUser> {
  if (!token || !token.startsWith(STAFF_TOKEN_PREFIX)) throw ApiError.unauthorized();
  const s = await app.db.one(`
    select s.id as session_id, s.user_id, s.last_used_at, s.created_at as session_created,
           u.banned_until, p.role::text as role, p.full_name, p.email, p.is_active
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.token_hash = :h and s.revoked_at is null and s.expires_at > now()`, { h: hashToken(token) });
  if (!s) throw ApiError.unauthorized();
  if (s.bannedUntil != null && (s.bannedUntil === 'infinity' || new Date(s.bannedUntil) > new Date())) throw ApiError.unauthorized();
  if (s.role == null || s.isActive !== true) throw ApiError.forbidden('Akun tidak aktif');
  if (Date.now() - new Date(s.lastUsedAt).getTime() > 60_000) {
    await app.db.update(`update auth.sessions
      set last_used_at = now(),
          expires_at = least(now() + make_interval(hours => :h), created_at + make_interval(days => :d))
      where id = :id`, { h: app.cfg.sessionHours, d: MAX_SESSION_DAYS, id: s.sessionId });
  }
  const wards = await app.db.list('select ward_id from public.nurse_wards where nurse_id = :id', { id: s.userId });
  return { id: s.userId, role: s.role, fullName: s.fullName, email: s.email, wardIds: wards.map((w) => w.wardId), sessionId: s.sessionId };
}

export async function resolveTablet(app: App, token: string | null): Promise<TabletIdentity | null> {
  if (!token) return null;
  if (!token.startsWith(TABLET_TOKEN_PREFIX)) throw ApiError.unauthorized();
  const t = await app.db.one('select id, device_code, bed_id, disabled_at from public.tablets where device_token_hash = :h',
    { h: hashToken(token) });
  if (!t) throw ApiError.unauthorized();
  if (t.disabledAt != null) throw ApiError.forbidden('Tablet dinonaktifkan');
  return { id: t.id, deviceCode: t.deviceCode, bedId: t.bedId };
}

export async function login(app: App, emailRaw: string, password: string, ip: string, userAgent: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!app.rate.allow(`login-ip:${ip}`, 100, 15 * 60_000) || !app.rate.allow(`login-email:${email}`, 10, 15 * 60_000)) {
    throw new ApiError(429, 'rate_limited', 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.');
  }
  const u = await app.db.one(`
    select u.id, u.password_hash, u.email_confirmed_at, u.banned_until, u.locked_until,
           p.is_active, p.role::text as role
    from auth.users u left join public.profiles p on p.id = u.id
    where lower(u.email) = :e`, { e: email });
  if (!u || !u.passwordHash) {
    await burnTime(password);
    throw new ApiError(401, 'invalid_credentials', 'Email atau kata sandi salah.');
  }
  if (u.lockedUntil != null && new Date(u.lockedUntil) > new Date()) {
    throw new ApiError(429, 'account_locked', 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.');
  }
  const ok = await verifyPassword(app.db, password, u.passwordHash);
  if (!ok) {
    await app.db.update(`update auth.users
      set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= :max then now() + make_interval(mins => :m) else locked_until end
      where id = :id`, { max: LOCK_AFTER_FAILS, m: LOCK_MINUTES, id: u.id });
    throw new ApiError(401, 'invalid_credentials', 'Email atau kata sandi salah.');
  }
  const banned = u.bannedUntil != null && (u.bannedUntil === 'infinity' || new Date(u.bannedUntil) > new Date());
  if (banned || u.isActive === false || u.role == null) {
    throw new ApiError(403, 'account_disabled', 'Akun ini dinonaktifkan. Hubungi admin rumah sakit.');
  }
  if (u.emailConfirmedAt == null) {
    throw new ApiError(403, 'email_not_confirmed', 'Email belum diverifikasi. Buka tautan undangan di email Anda.');
  }
  const rehash = isLegacyBcrypt(u.passwordHash) ? await hashPassword(password) : null;
  await app.db.update(`update auth.users
    set failed_attempts = 0, locked_until = null, last_sign_in_at = now(),
        password_hash = coalesce(:rehash, password_hash)
    where id = :id`, { rehash, id: u.id });
  if (rehash) log.info('hash_lama_diperbarui', { user: u.id });
  app.rate.reset(`login-email:${email}`);
  const token = newToken(STAFF_TOKEN_PREFIX);
  const s = await app.db.one(`
    insert into auth.sessions (user_id, token_hash, expires_at, ip, user_agent)
    values (:u, :h, now() + make_interval(hours => :hours), :ip, :ua)
    returning id, expires_at`, { u: u.id, h: hashToken(token), hours: app.cfg.sessionHours, ip, ua: userAgent });
  return { accessToken: token, tokenType: 'bearer', expiresAt: s!.expiresAt, user: { id: u.id, email } };
}

export async function logout(app: App, staff: StaffUser) {
  await app.db.update('update auth.sessions set revoked_at = now() where id = :id and revoked_at is null', { id: staff.sessionId });
  app.hub.disconnectSession(staff.sessionId);
  return { ok: true };
}

export async function revokeAllSessions(app: App, db: Db, userId: string) {
  await db.update('update auth.sessions set revoked_at = now() where user_id = :u and revoked_at is null', { u: userId });
  app.hub.disconnectUser(userId);
}

export async function createLinkToken(app: App, db: Db, userId: string, purpose: 'invite' | 'recovery'): Promise<string> {
  const token = newToken(LINK_TOKEN_PREFIX);
  const minutes = purpose === 'invite' ? app.cfg.inviteTokenHours * 60 : app.cfg.resetTokenMinutes;
  await db.update("update auth.tokens set used_at = now() where user_id = :u and purpose = :p and used_at is null", { u: userId, p: purpose });
  await db.update(`insert into auth.tokens (user_id, purpose, token_hash, expires_at)
    values (:u, :p, :h, now() + make_interval(mins => :m))`, { u: userId, p: purpose, h: hashToken(token), m: minutes });
  return token;
}

export function linkUrl(app: App, token: string, purpose: 'invite' | 'recovery'): string {
  return `${setPasswordUrl(app.cfg)}#token=${encodeURIComponent(token)}&type=${purpose}`;
}

export async function sendAccountEmail(app: App, db: Db, userId: string, byAdmin: boolean) {
  const u = await db.one('select email, email_confirmed_at from auth.users where id = :id', { id: userId });
  if (!u) throw ApiError.notFound('Akun');
  const purpose = u.emailConfirmedAt == null ? 'invite' : 'recovery';
  const token = await createLinkToken(app, db, userId, purpose);
  const url = linkUrl(app, token, purpose);
  try {
    if (purpose === 'invite') await app.mailer.sendInvite(u.email, url);
    else await app.mailer.sendRecovery(u.email, url, byAdmin);
  } catch (e) {
    log.error('email_gagal', { purpose, error: (e as Error).message.slice(0, 200) });
    throw new ApiError(502, 'email_failed', 'Email gagal dikirim. Periksa pengaturan SMTP server.');
  }
  return purpose;
}

async function findLinkToken(app: App, token: unknown) {
  if (typeof token !== 'string' || !token.startsWith(LINK_TOKEN_PREFIX) || token.length > 200) return null;
  return app.db.one(`
    select t.id, t.user_id, t.purpose, u.email
    from auth.tokens t join auth.users u on u.id = t.user_id
    where t.token_hash = :h and t.used_at is null and t.expires_at > now()`, { h: hashToken(token) });
}

export async function checkLinkToken(app: App, token: unknown, ip: string) {
  app.rate.check(`link:${ip}`, 30, 15 * 60_000);
  const t = await findLinkToken(app, token);
  if (!t) return { valid: false };
  return { valid: true, email: t.email, purpose: t.purpose };
}

export async function setPasswordWithToken(app: App, token: unknown, password: unknown, ip: string) {
  app.rate.check(`link:${ip}`, 30, 15 * 60_000);
  const problem = validateNewPassword(password);
  if (problem) throw ApiError.invalid('weak_password', problem);
  const t = await findLinkToken(app, token);
  if (!t) throw ApiError.invalid('invalid_token', 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru ke admin rumah sakit.');
  const hash = await hashPassword(password as string);
  await app.db.tx(async (db) => {
    const used = await db.update('update auth.tokens set used_at = now() where id = :id and used_at is null', { id: t.id });
    if (used === 0) throw ApiError.invalid('invalid_token', 'Tautan sudah dipakai.');
    await db.update(`update auth.users
      set password_hash = :h, password_changed_at = now(), email_confirmed_at = coalesce(email_confirmed_at, now()),
          failed_attempts = 0, locked_until = null
      where id = :u`, { h: hash, u: t.userId });
    await db.update('update auth.tokens set used_at = now() where user_id = :u and used_at is null', { u: t.userId });
    await revokeAllSessions(app, db, t.userId);
  });
  log.info('sandi_diatur', { purpose: t.purpose, user: t.userId });
  return { ok: true, email: t.email };
}

export async function forgotPassword(app: App, emailRaw: string, ip: string) {
  const message = 'Jika email terdaftar, tautan atur ulang kata sandi sudah dikirim.';
  const email = emailRaw.trim().toLowerCase();
  if (!app.rate.allow(`forgot-ip:${ip}`, 5, 15 * 60_000) || !app.rate.allow(`forgot-email:${email}`, 3, 60 * 60_000)) {
    return { message };
  }
  const u = await app.db.one(`select u.id from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = :e and p.is_active and u.email_confirmed_at is not null`, { e: email });
  if (u) {
    try {
      await sendAccountEmail(app, app.db, u.id, false);
    } catch {
    }
  }
  return { message };
}

export async function changePassword(app: App, staff: StaffUser, current: unknown, next: unknown) {
  app.rate.check(`change:${staff.id}`, 10, 15 * 60_000);
  const u = await app.db.one('select password_hash from auth.users where id = :id', { id: staff.id });
  if (typeof current !== 'string' || !u || !(await verifyPassword(app.db, current, u.passwordHash))) {
    throw new ApiError(401, 'invalid_credentials', 'Kata sandi lama salah.');
  }
  const problem = validateNewPassword(next);
  if (problem) throw ApiError.invalid('weak_password', problem);
  const hash = await hashPassword(next as string);
  await app.db.update('update auth.users set password_hash = :h, password_changed_at = now() where id = :id', { h: hash, id: staff.id });
  await app.db.update('update auth.sessions set revoked_at = now() where user_id = :u and id <> :s and revoked_at is null',
    { u: staff.id, s: staff.sessionId });
  return { ok: true };
}
