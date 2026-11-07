import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  applicationName?: string;
  connectTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
}

export class PgError extends Error {
  code: string;
  detail?: string;
  constraint?: string;
  table?: string;
  severity?: string;
  constructor(fields: Record<string, string>) {
    super(fields.M || 'Postgres error');
    this.name = 'PgError';
    this.code = fields.C || '';
    this.detail = fields.D;
    this.constraint = fields.n;
    this.table = fields.t;
    this.severity = fields.S;
  }
}

export function parseDatabaseUrl(url: string): Omit<PgConfig, 'applicationName'> {
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('DATABASE_URL harus postgres://');
  return {
    host: decodeURIComponent(u.hostname),
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || decodeURIComponent(u.username),
  };
}

const OID = {
  bool: 16, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, json: 114, float4: 700, float8: 701,
  boolArr: 1000, int2Arr: 1005, int4Arr: 1007, textArr: 1009, varcharArr: 1015, int8Arr: 1016,
  date: 1082, time: 1083, timestamp: 1114, timestamptz: 1184, numeric: 1700, uuid: 2950, uuidArr: 2951, jsonb: 3802,
} as const;

export function pgTimestampToIso(s: string): string {
  if (s === 'infinity' || s === '-infinity') return s;
  const m = /^(\d{4,})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?([+-]\d\d(?::?\d\d)?(?::?\d\d)?)?( BC)?$/.exec(s);
  if (!m) return s;
  const [, y, mo, d, h, mi, se, frac = '', tz] = m;
  let iso: string;
  if (!tz || /^\+00(:?00)?$/.test(tz)) {
    iso = `${y}-${mo}-${d}T${h}:${mi}:${se}`;
  } else {
    const tzNorm = tz.length === 3 ? `${tz}:00` : tz.replace(/^([+-]\d\d)(\d\d)$/, '$1:$2');
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${tzNorm}`);
    iso = dt.toISOString().slice(0, 19);
  }
  const f = frac.replace(/0+$/, '');
  if (!f) return `${iso}Z`;
  return `${iso}.${f.length <= 3 ? f.padEnd(3, '0') : f.padEnd(6, '0').slice(0, 6)}Z`;
}

export function parsePgArray(s: string, item: (v: string) => unknown): unknown[] {
  if (s === '{}') return [];
  const out: unknown[] = [];
  let i = 1;
  while (i < s.length - 1) {
    let val = '';
    let quoted = false;
    if (s[i] === '"') {
      quoted = true;
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++;
        val += s[i];
        i++;
      }
      i++;
    } else {
      while (i < s.length - 1 && s[i] !== ',') val += s[i++];
    }
    out.push(!quoted && val === 'NULL' ? null : item(val));
    i++;
  }
  return out;
}

function convert(oid: number, v: string): unknown {
  switch (oid) {
    case OID.bool: return v === 't';
    case OID.int2: case OID.int4: case OID.oid: case OID.int8: case OID.float4: case OID.float8: case OID.numeric:
      return Number(v);
    case OID.json: case OID.jsonb: return JSON.parse(v);
    case OID.timestamptz: case OID.timestamp: return pgTimestampToIso(v);
    case OID.time: return v.slice(0, 5);
    case OID.textArr: case OID.varcharArr: case OID.uuidArr: return parsePgArray(v, (x) => x);
    case OID.int2Arr: case OID.int4Arr: case OID.int8Arr: return parsePgArray(v, Number);
    case OID.boolArr: return parsePgArray(v, (x) => x === 't');
    default: return v;
  }
}

export function serializeParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return `\\x${v.toString('hex')}`;
  return JSON.stringify(v);
}

class Writer {
  private parts: Buffer[] = [];
  private len = 0;
  int8(n: number) { return this.push(Buffer.from([n])); }
  int16(n: number) { const b = Buffer.alloc(2); b.writeInt16BE(n); return this.push(b); }
  int32(n: number) { const b = Buffer.alloc(4); b.writeInt32BE(n); return this.push(b); }
  cstr(s: string) { return this.push(Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])); }
  bytes(b: Buffer) { return this.push(b); }
  private push(b: Buffer) { this.parts.push(b); this.len += b.length; return this; }
  msg(type: string): Buffer {
    const head = Buffer.alloc(5);
    head.write(type, 0, 'ascii');
    head.writeInt32BE(this.len + 4, 1);
    return Buffer.concat([head, ...this.parts]);
  }
  raw(): Buffer {
    const head = Buffer.alloc(4);
    head.writeInt32BE(this.len + 4, 0);
    return Buffer.concat([head, ...this.parts]);
  }
}

interface Field { name: string; oid: number }

interface Pending {
  resolve: (r: QueryResult[]) => void;
  reject: (e: Error) => void;
  results: QueryResult[];
  fields: Field[] | null;
  current: QueryResult | null;
  error: PgError | null;
}

function readCStr(buf: Buffer, off: number): [string, number] {
  const end = buf.indexOf(0, off);
  return [buf.toString('utf8', off, end), end + 1];
}

export class PgConnection extends EventEmitter {
  private sock!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private ready = false;
  closed = false;
  private scram: { nonce: string; clientFirstBare: string; serverSignature?: Buffer } | null = null;
  private onStartup: { resolve: () => void; reject: (e: Error) => void } | null = null;

  private cfg: PgConfig;
  constructor(cfg: PgConfig) {
    super();
    this.cfg = cfg;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.sock?.destroy();
        reject(new Error(`Tidak bisa terhubung ke database ${this.cfg.host}:${this.cfg.port} (timeout)`));
      }, this.cfg.connectTimeoutMs ?? 10_000);
      this.onStartup = {
        resolve: () => { clearTimeout(timeout); resolve(); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      };
      this.sock = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      this.sock.setNoDelay(true);
      this.sock.setKeepAlive(true, 30_000);
      this.sock.on('connect', () => {
        const w = new Writer().int32(196608)
          .cstr('user').cstr(this.cfg.user)
          .cstr('database').cstr(this.cfg.database)
          .cstr('client_encoding').cstr('UTF8')
          .cstr('TimeZone').cstr('UTC')
          .cstr('DateStyle').cstr('ISO, MDY')
          .cstr('application_name').cstr(this.cfg.applicationName ?? 'vocaline-backend');
        if (this.cfg.statementTimeoutMs) w.cstr('options').cstr(`-c statement_timeout=${this.cfg.statementTimeoutMs}`);
        this.sock.write(w.int8(0).raw());
      });
      this.sock.on('data', (d: Buffer) => this.onData(d));
      this.sock.on('error', (e) => this.fail(e));
      this.sock.on('close', () => this.fail(new Error('Koneksi database tertutup')));
    });
  }

  private fail(e: Error) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.onStartup) { this.onStartup.reject(e); this.onStartup = null; }
    for (const p of this.queue.splice(0)) p.reject(e);
    this.sock?.destroy();
    this.emit('end', e);
  }

  private send(b: Buffer) { this.sock.write(b); }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      try {
        this.handle(type, body);
      } catch (e) {
        this.fail(e as Error);
        return;
      }
    }
  }

  private handle(type: string, body: Buffer) {
    switch (type) {
      case 'R': return this.auth(body);
      case 'S': case 'K': case '1': case '2': case '3': case 'n': case 's': case 'I': case 't': return;
      case 'N': return;
      case 'A': {
        let off = 4;
        let channel: string, payload: string;
        [channel, off] = readCStr(body, off);
        [payload] = readCStr(body, off);
        this.emit('notification', { channel, payload });
        return;
      }
      case 'E': {
        const fields: Record<string, string> = {};
        let off = 0;
        while (off < body.length && body[off] !== 0) {
          const k = String.fromCharCode(body[off]);
          let v: string;
          [v, off] = readCStr(body, off + 1);
          fields[k] = v;
        }
        const err = new PgError(fields);
        if (!this.ready) {
          this.onStartup?.reject(err);
          this.onStartup = null;
          this.fail(err);
          return;
        }
        const p = this.queue[0];
        if (p) p.error = err;
        return;
      }
      case 'Z': {
        if (!this.ready) {
          this.ready = true;
          this.onStartup?.resolve();
          this.onStartup = null;
          return;
        }
        const p = this.queue.shift();
        if (!p) return;
        if (p.error) p.reject(p.error);
        else p.resolve(p.results);
        return;
      }
      case 'T': {
        const p = this.queue[0];
        if (!p) return;
        const n = body.readInt16BE(0);
        let off = 2;
        const fields: Field[] = [];
        for (let i = 0; i < n; i++) {
          let name: string;
          [name, off] = readCStr(body, off);
          const oid = body.readInt32BE(off + 6);
          off += 18;
          fields.push({ name, oid });
        }
        p.fields = fields;
        p.current = { rows: [], rowCount: 0, command: '' };
        return;
      }
      case 'D': {
        const p = this.queue[0];
        if (!p || !p.fields) return;
        if (!p.current) p.current = { rows: [], rowCount: 0, command: '' };
        const n = body.readInt16BE(0);
        let off = 2;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const len = body.readInt32BE(off);
          off += 4;
          const f = p.fields[i];
          if (len === -1) { row[f.name] = null; continue; }
          row[f.name] = convert(f.oid, body.toString('utf8', off, off + len));
          off += len;
        }
        p.current.rows.push(row);
        return;
      }
      case 'C': {
        const p = this.queue[0];
        if (!p) return;
        const [tag] = readCStr(body, 0);
        const parts = tag.split(' ');
        const count = Number(parts[parts.length - 1]);
        const res = p.current ?? { rows: [], rowCount: 0, command: '' };
        res.command = parts[0];
        res.rowCount = Number.isFinite(count) ? count : res.rows.length;
        p.results.push(res);
        p.current = null;
        p.fields = null;
        return;
      }
      default:
        return;
    }
  }

  private auth(body: Buffer) {
    const code = body.readInt32BE(0);
    const pass = this.cfg.password;
    if (code === 0) return;
    if (code === 3) { this.send(new Writer().cstr(pass).msg('p')); return; }
    if (code === 5) {
      const salt = body.subarray(4, 8);
      const inner = crypto.createHash('md5').update(pass + this.cfg.user).digest('hex');
      const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
      this.send(new Writer().cstr(`md5${outer}`).msg('p'));
      return;
    }
    if (code === 10) {
      const mechs = body.subarray(4).toString('utf8').split('\0').filter(Boolean);
      if (!mechs.includes('SCRAM-SHA-256')) throw new Error(`Mekanisme SASL tidak didukung: ${mechs.join(',')}`);
      const nonce = crypto.randomBytes(18).toString('base64');
      const clientFirstBare = `n=*,r=${nonce}`;
      this.scram = { nonce, clientFirstBare };
      const data = Buffer.from(`n,,${clientFirstBare}`);
      this.send(new Writer().cstr('SCRAM-SHA-256').int32(data.length).bytes(data).msg('p'));
      return;
    }
    if (code === 11) {
      if (!this.scram) throw new Error('SCRAM tidak dimulai');
      const serverFirst = body.subarray(4).toString('utf8');
      const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
      if (!attrs.r?.startsWith(this.scram.nonce)) throw new Error('SCRAM nonce tidak cocok');
      const salted = crypto.pbkdf2Sync(pass.normalize('NFKC'), Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
      const hmac = (key: Buffer, s: string) => crypto.createHmac('sha256', key).update(s).digest();
      const clientKey = hmac(salted, 'Client Key');
      const storedKey = crypto.createHash('sha256').update(clientKey).digest();
      const finalNoProof = `c=biws,r=${attrs.r}`;
      const authMessage = `${this.scram.clientFirstBare},${serverFirst},${finalNoProof}`;
      const clientSig = hmac(storedKey, authMessage);
      const proof = Buffer.alloc(clientKey.length);
      for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ clientSig[i];
      this.scram.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
      this.send(new Writer().bytes(Buffer.from(`${finalNoProof},p=${proof.toString('base64')}`)).msg('p'));
      return;
    }
    if (code === 12) {
      const final = body.subarray(4).toString('utf8');
      const v = final.split(',').find((x) => x.startsWith('v='))?.slice(2);
      if (!v || !this.scram?.serverSignature
        || !crypto.timingSafeEqual(Buffer.from(v, 'base64'), this.scram.serverSignature)) {
        throw new Error('Tanda tangan server SCRAM tidak valid');
      }
      return;
    }
    throw new Error(`Metode autentikasi Postgres tidak didukung (kode ${code})`);
  }

  private enqueue(buf: Buffer): Promise<QueryResult[]> {
    if (this.closed) return Promise.reject(new Error('Koneksi database tertutup'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, results: [], fields: null, current: null, error: null });
      this.send(buf);
    });
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    const parse = new Writer().cstr('').cstr(text).int16(0).msg('P');
    const bind = new Writer().cstr('').cstr('').int16(0).int16(params.length);
    for (const p of params) {
      const s = serializeParam(p);
      if (s === null) bind.int32(-1);
      else {
        const b = Buffer.from(s, 'utf8');
        bind.int32(b.length).bytes(b);
      }
    }
    bind.int16(0);
    const describe = new Writer().int8('P'.charCodeAt(0)).cstr('').msg('D');
    const execute = new Writer().cstr('').int32(0).msg('E');
    const sync = new Writer().msg('S');
    const results = await this.enqueue(Buffer.concat([parse, bind.msg('B'), describe, execute, sync]));
    return results[0] ?? { rows: [], rowCount: 0, command: '' };
  }

  async simple(text: string): Promise<QueryResult[]> {
    return this.enqueue(new Writer().cstr(text).msg('Q'));
  }

  close() {
    if (this.closed) return;
    try { this.sock.write(new Writer().msg('X')); } catch { }
    this.closed = true;
    this.sock.end();
  }
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export class PgPool implements Queryable {
  private idle: PgConnection[] = [];
  private all = new Set<PgConnection>();
  private waiters: { resolve: (c: PgConnection) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private ending = false;

  private cfg: PgConfig;
  private max: number;
  private acquireTimeoutMs: number;
  constructor(cfg: PgConfig, max = 10, acquireTimeoutMs = 10_000) {
    this.cfg = cfg;
    this.max = max;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  get size() { return this.all.size; }

  private async create(): Promise<PgConnection> {
    const c = new PgConnection(this.cfg);
    this.all.add(c);
    c.on('end', () => {
      this.all.delete(c);
      this.idle = this.idle.filter((x) => x !== c);
    });
    try {
      await c.connect();
    } catch (e) {
      this.all.delete(c);
      throw e;
    }
    return c;
  }

  async acquire(): Promise<PgConnection> {
    if (this.ending) throw new Error('Pool ditutup');
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.closed) return c;
    }
    if (this.all.size < this.max) return this.create();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error('Semua koneksi database sedang dipakai (timeout)'));
      }, this.acquireTimeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  release(c: PgConnection) {
    if (c.closed) {
      const w = this.waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        this.create().then(w.resolve, w.reject);
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(c);
    } else {
      this.idle.push(c);
    }
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    const c = await this.acquire();
    try {
      return await c.query(text, params);
    } finally {
      this.release(c);
    }
  }

  async simple(text: string): Promise<QueryResult[]> {
    const c = await this.acquire();
    try {
      return await c.simple(text);
    } finally {
      this.release(c);
    }
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      await c.simple('BEGIN');
      try {
        const out = await fn(c);
        await c.simple('COMMIT');
        return out;
      } catch (e) {
        if (!c.closed) await c.simple('ROLLBACK').catch(() => c.close());
        throw e;
      }
    } finally {
      this.release(c);
    }
  }

  async end() {
    this.ending = true;
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error('Pool ditutup')); }
    for (const c of [...this.all]) c.close();
    this.all.clear();
    this.idle = [];
  }
}

export class PgListener extends EventEmitter {
  private conn: PgConnection | null = null;
  private stopped = false;
  private cfg: PgConfig;
  private channels: string[];
  constructor(cfg: PgConfig, channels: string[]) {
    super();
    this.cfg = cfg;
    this.channels = channels;
  }
  async start() {
    this.stopped = false;
    await this.open();
  }
  private async open(): Promise<void> {
    if (this.stopped) return;
    try {
      const c = new PgConnection({ ...this.cfg, applicationName: 'vocaline-listener', statementTimeoutMs: undefined });
      await c.connect();
      c.on('notification', (n) => this.emit('notification', n));
      c.on('end', () => {
        if (this.stopped) return;
        this.emit('disconnected');
        setTimeout(() => this.open(), 2000);
      });
      await c.simple(this.channels.map((ch) => `LISTEN "${ch.replace(/"/g, '')}"`).join(';'));
      this.conn = c;
      this.emit('connected');
    } catch (e) {
      this.emit('connect_error', e);
      setTimeout(() => this.open(), 3000);
    }
  }
  stop() {
    this.stopped = true;
    this.conn?.close();
  }
}
