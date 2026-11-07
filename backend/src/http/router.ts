import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errorBody } from './errors.ts';
import { log } from '../lib/log.ts';
import { isIntegrityViolation, isUniqueViolation } from '../db/db.ts';

export type Access =
  | { kind: 'public' }
  | { kind: 'cron' }
  | { kind: 'tablet'; allowUnregistered?: boolean }
  | { kind: 'staff'; roles?: readonly string[] };

export interface StaffUser {
  id: string;
  role: 'superadmin' | 'nurse';
  fullName: string;
  email: string;
  wardIds: string[];
  sessionId: string;
}

export interface TabletIdentity {
  id: string | null;
  deviceCode: string | null;
  bedId: string | null;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  userAgent: string;
  staff?: StaffUser;
  tablet?: TabletIdentity;
  body(): Promise<unknown>;
}

export class Reply {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  raw: boolean;
  constructor(status: number, body: unknown, headers: Record<string, string> = {}, raw = false) {
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.raw = raw;
  }
}
export const HANDLED = Symbol('handled');

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  parts: string[];
  access: Access;
  handler: Handler;
}

export type AccessResolver = (ctx: Ctx, access: Access) => Promise<void>;

export interface RouterOptions {
  corsOrigins: string[];
  maxBodyBytes: number;
  resolveAccess: AccessResolver;
}

function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

export class Router {
  private routes: Route[] = [];
  private opts: RouterOptions;
  constructor(opts: RouterOptions) {
    this.opts = opts;
  }

  add(method: string, path: string, access: Access, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), access, handler });
  }
  get(p: string, a: Access, h: Handler) { this.add('GET', p, a, h); }
  post(p: string, a: Access, h: Handler) { this.add('POST', p, a, h); }
  put(p: string, a: Access, h: Handler) { this.add('PUT', p, a, h); }
  patch(p: string, a: Access, h: Handler) { this.add('PATCH', p, a, h); }
  delete(p: string, a: Access, h: Handler) { this.add('DELETE', p, a, h); }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const segs = path.split('/').filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = segs[i];
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }

  private cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && origin === `${proto}://${host}`) return true;
    if (!this.opts.corsOrigins.includes(origin.replace(/\/+$/, ''))) {
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return true;
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://localhost');
    const method = (req.method || 'GET').toUpperCase();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (!this.cors(req, res)) return this.send(res, 403, errorBody('forbidden', 'Origin tidak diizinkan'));
    if (method === 'OPTIONS') {
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.statusCode = 204;
      return res.end();
    }

    const m = this.match(method, url.pathname);
    if (m === null) return this.send(res, 404, errorBody('not_found', 'Endpoint tidak ada'));
    if (m === 'method') return this.send(res, 405, errorBody('method_not_allowed', 'Method tidak didukung'));

    let bodyPromise: Promise<unknown> | null = null;
    const ctx: Ctx = {
      req, res, method, path: url.pathname, params: m.params, query: url.searchParams,
      ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      body: () => (bodyPromise ??= this.readBody(req)),
    };
    try {
      await this.opts.resolveAccess(ctx, m.route.access);
      const out = await m.route.handler(ctx);
      if (out === HANDLED) return;
      if (out instanceof Reply) {
        for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
        if (out.raw) {
          res.statusCode = out.status;
          return res.end(out.body as string | Buffer);
        }
        return this.send(res, out.status, out.body);
      }
      return this.send(res, 200, out);
    } catch (e) {
      this.sendError(res, e);
    } finally {
      log.debug('http', { method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
    }
  }

  private sendError(res: ServerResponse, e: unknown) {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof ApiError) return this.send(res, e.status, errorBody(e.code, e.message, e.details));
    if (isUniqueViolation(e)) return this.send(res, 409, errorBody('conflict', 'Data sudah ada'));
    const err = e as Error & { code?: string };
    log.error('unhandled', { type: err?.name, code: err?.code, msg: String(err?.message).slice(0, 200),
      integrity: isIntegrityViolation(e) });
    return this.send(res, 500, errorBody('internal', 'Terjadi kesalahan di server'));
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    if (res.headersSent) { res.end(); return; }
    const json = JSON.stringify(body === undefined ? null : body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(json));
    res.end(json);
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const max = this.opts.maxBodyBytes;
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > max) {
        req.resume();
        return reject(new ApiError(413, 'payload_too_large', 'Data terlalu besar'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c: Buffer) => {
        if (aborted) return;
        size += c.length;
        if (size > max) {
          aborted = true;
          reject(new ApiError(413, 'payload_too_large', 'Data terlalu besar'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve(undefined);
        const ct = String(req.headers['content-type'] || '');
        if (ct && !ct.includes('json')) return reject(new ApiError(415, 'unsupported_media_type', 'Content-Type harus application/json'));
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(ApiError.invalid('validation', 'Data tidak valid'));
        }
      });
      req.on('error', reject);
    });
  }
}
