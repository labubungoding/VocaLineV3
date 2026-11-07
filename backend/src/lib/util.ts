import crypto from 'node:crypto';
import { ApiError } from '../http/errors.ts';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DEVICE = new RegExp(`^VL-[${ALPHABET}]{4}-[${ALPHABET}]{4}$`);
const COMPACT = /^VL[A-Z0-9]{8}$/;

function part(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

export function newDeviceCode(): string {
  return `VL-${part()}-${part()}`;
}

export function normalizeDeviceCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toUpperCase().replace(/\s+/g, '');
  if (COMPACT.test(s)) s = `VL-${s.slice(2, 6)}-${s.slice(6)}`;
  return DEVICE.test(s) ? s : null;
}

function slug(s: string): string {
  return s.normalize('NFKD').replace(/[^A-Za-z0-9_]+/g, '').toUpperCase();
}

export function bedCode(wardName: string, roomNumber: string, bedNumber: string): string {
  return `${slug(wardName)}-${slug(roomNumber)}-${slug(bedNumber)}`;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

export function uuidPath(raw: string | undefined, what: string): string {
  if (raw == null || !isUuid(raw)) throw ApiError.notFound(what);
  return raw.trim().toLowerCase();
}

export function uuidOrNull(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === '') return null;
  if (!isUuid(raw)) throw ApiError.invalid('validation', 'ID tidak valid');
  return raw.trim().toLowerCase();
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  check(key: string, max: number, windowMs: number) {
    if (!this.allow(key, max, windowMs)) throw ApiError.rateLimited();
  }
  allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const q = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (q.length >= max) {
      this.hits.set(key, q);
      return false;
    }
    q.push(now);
    this.hits.set(key, q);
    if (this.hits.size > 20_000) this.sweep(windowMs);
    return true;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
  private sweep(windowMs: number) {
    const now = Date.now();
    for (const [k, q] of this.hits) if (!q.some((t) => now - t < windowMs)) this.hits.delete(k);
    if (this.hits.size > 20_000) this.hits.clear();
  }
}

export function localDate(tz: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

export function startOfLocalDay(tz: string, date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  let off = offsetMinutes(tz, guess);
  off = offsetMinutes(tz, new Date(guess.getTime() - off * 60000));
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T00:00:00${sign}${hh}:${mm}`;
}

export function startOfToday(tz: string): string {
  return startOfLocalDay(tz, localDate(tz));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function ageFromBirthDate(birth: string, tz = 'UTC'): number {
  const [by, bm, bd] = birth.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = localDate(tz).split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function constantTimeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}
