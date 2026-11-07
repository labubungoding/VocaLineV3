import type { PgPool, Queryable, QueryResult } from './pg.ts';

export type Params = Record<string, unknown>;
export type Row = Record<string, any>;

export function toCamel(snake: string): string {
  let out = '';
  let up = false;
  for (const c of snake) {
    if (c === '_') { up = true; continue; }
    out += up ? c.toUpperCase() : c;
    up = false;
  }
  return out;
}

export function compileNamed(sql: string, params: Params): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ':' && sql[i + 1] === ':') { out += '::'; i += 2; continue; }
    if (c === ':' && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!(name in params)) throw new Error(`Parameter SQL :${name} tidak diberikan`);
      const v = params[name];
      if (Array.isArray(v)) {
        if (v.length === 0) out += 'NULL';
        else out += v.map((x) => { values.push(x); return `$${values.length}`; }).join(', ');
      } else {
        values.push(v);
        out += `$${values.length}`;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, values };
}

function camelRows(r: QueryResult): Row[] {
  return r.rows.map((row) => {
    const o: Row = {};
    for (const k of Object.keys(row)) o[toCamel(k)] = row[k];
    return o;
  });
}

export class Db {
  q: Queryable;
  pool: PgPool | null;
  constructor(q: Queryable, pool: PgPool | null) {
    this.q = q;
    this.pool = pool;
  }

  async raw(sql: string, params: Params = {}): Promise<QueryResult> {
    const { text, values } = compileNamed(sql, params);
    return this.q.query(text, values);
  }
  async list(sql: string, params: Params = {}): Promise<Row[]> {
    return camelRows(await this.raw(sql, params));
  }
  async one(sql: string, params: Params = {}): Promise<Row | null> {
    const rows = await this.list(sql, params);
    return rows[0] ?? null;
  }
  async update(sql: string, params: Params = {}): Promise<number> {
    return (await this.raw(sql, params)).rowCount;
  }
  async count(sql: string, params: Params = {}): Promise<number> {
    const r = await this.raw(sql, params);
    const row = r.rows[0];
    if (!row) return 0;
    const v = Object.values(row)[0];
    return v == null ? 0 : Number(v);
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.pool) return fn(this);
    return this.pool.tx((conn) => fn(new Db(conn, null)));
  }
}

export const PgCodes = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
};

export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === PgCodes.uniqueViolation;
}

export function isIntegrityViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return typeof code === 'string' && code.startsWith('23');
}
