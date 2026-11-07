import { ApiError } from './errors.ts';
import { isUuid } from '../lib/util.ts';

type Issue = { field: string; message: string };
type Check<T> = (value: unknown, field: string, issues: Issue[]) => T;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

function fail(issues: Issue[], field: string, message: string): undefined {
  issues.push({ field, message });
  return undefined;
}

class TypeMismatch extends Error {}

export interface StrOpts {
  required?: boolean;
  notBlank?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  email?: boolean;
}

export const v = {
  str(o: StrOpts = {}): Check<string | null> {
    return (val, field, issues) => {
      if (val === undefined || val === null) {
        if (o.required || o.notBlank) fail(issues, field, 'wajib diisi');
        return null;
      }
      let s: string;
      if (typeof val === 'string') s = val;
      else if (typeof val === 'number' || typeof val === 'boolean') s = String(val);
      else throw new TypeMismatch(field);
      if (o.notBlank && s.trim() === '') { fail(issues, field, 'wajib diisi'); return s; }
      if (o.min !== undefined && s.length < o.min) fail(issues, field, `minimal ${o.min} karakter`);
      if (o.max !== undefined && s.length > o.max) fail(issues, field, `maksimal ${o.max} karakter`);
      if (o.pattern && !o.pattern.test(s)) fail(issues, field, 'format tidak sesuai');
      if (o.email && !EMAIL.test(s)) fail(issues, field, 'email tidak valid');
      return s;
    };
  },
  int(o: { required?: boolean; min?: number; max?: number } = {}): Check<number | null> {
    return (val, field, issues) => {
      if (val === undefined || val === null) {
        if (o.required) fail(issues, field, 'wajib diisi');
        return null;
      }
      let n: number;
      if (typeof val === 'number') n = val;
      else if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) n = Number(val.trim());
      else throw new TypeMismatch(field);
      if (!Number.isInteger(n)) throw new TypeMismatch(field);
      if (o.min !== undefined && n < o.min) fail(issues, field, `minimal ${o.min}`);
      if (o.max !== undefined && n > o.max) fail(issues, field, `maksimal ${o.max}`);
      return n;
    };
  },
  bool(o: { required?: boolean } = {}): Check<boolean | null> {
    return (val, field, issues) => {
      if (val === undefined || val === null) {
        if (o.required) fail(issues, field, 'wajib diisi');
        return null;
      }
      if (typeof val === 'boolean') return val;
      if (val === 'true' || val === 'false') return val === 'true';
      throw new TypeMismatch(field);
    };
  },
  uuid(o: { required?: boolean } = {}): Check<string | null> {
    return (val, field, issues) => {
      if (val === undefined || val === null) {
        if (o.required) fail(issues, field, 'wajib diisi');
        return null;
      }
      if (typeof val !== 'string' || !isUuid(val)) throw new TypeMismatch(field);
      return val.trim().toLowerCase();
    };
  },
  list<T>(item: Check<T>, o: { required?: boolean; min?: number; max?: number } = {}): Check<T[] | null> {
    return (val, field, issues) => {
      if (val === undefined || val === null) {
        if (o.required) fail(issues, field, 'wajib diisi');
        return null;
      }
      if (!Array.isArray(val)) throw new TypeMismatch(field);
      if (o.min !== undefined && val.length < o.min) fail(issues, field, `minimal ${o.min} item`);
      if (o.max !== undefined && val.length > o.max) fail(issues, field, `maksimal ${o.max} item`);
      return val.map((x, i) => {
        if (x === null || x === undefined) {
          fail(issues, `${field}[${i}]`, 'wajib diisi');
          return x as T;
        }
        return item(x, `${field}[${i}]`, issues);
      });
    };
  },
  obj<S extends Record<string, Check<any>>>(shape: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> {
    return (val, field, issues) => {
      if (val === null || typeof val !== 'object' || Array.isArray(val)) throw new TypeMismatch(field);
      const out: Record<string, unknown> = {};
      for (const [k, check] of Object.entries(shape)) {
        out[k] = check((val as Record<string, unknown>)[k], field ? `${field}.${k}` : k, issues);
      }
      return out as { [K in keyof S]: ReturnType<S[K]> };
    };
  },
};

export function parseBody<T>(schema: Check<T>, body: unknown): T {
  const issues: Issue[] = [];
  let out: T;
  try {
    if (body === undefined) throw new TypeMismatch('body');
    out = schema(body, '', issues);
  } catch (e) {
    if (e instanceof TypeMismatch) throw ApiError.invalid('validation', 'Data tidak valid');
    throw e;
  }
  if (issues.length) throw ApiError.invalid('validation', 'Data tidak valid', { issues });
  return out;
}
