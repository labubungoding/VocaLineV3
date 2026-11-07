import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db/db.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, len: number, o: crypto.ScryptOptions) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function isLegacyBcrypt(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && /^\$2[aby]\$\d\d\$/.test(hash);
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

async function verifyBcrypt(db: Db, password: string, stored: string): Promise<boolean> {
  const row = await db.one('select crypt(:pw, :h) = :h as ok', { pw: password, h: stored });
  return row?.ok === true;
}

export async function verifyPassword(db: Db, password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) return verifyScrypt(password, stored);
  if (isLegacyBcrypt(stored)) return verifyBcrypt(db, password, stored);
  return false;
}

let dummy: string | null = null;
export async function burnTime(password: string) {
  dummy ??= await hashPassword('dummy-password-untuk-waktu');
  await verifyScrypt(password, dummy);
}

export function validateNewPassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Kata sandi wajib diisi.';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  return null;
}

export function newToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
