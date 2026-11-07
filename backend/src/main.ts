import http from 'node:http';
import { loadConfig, type Config } from './config.ts';
import { PgListener, PgPool } from './db/pg.ts';
import { Db } from './db/db.ts';
import { runMigrations } from './db/migrate.ts';
import { Router, type Access, type Ctx } from './http/router.ts';
import { ApiError } from './http/errors.ts';
import { log, setLogLevel } from './lib/log.ts';
import { RateLimiter, constantTimeEquals } from './lib/util.ts';
import { EventHub } from './realtime/hub.ts';
import { MlClient } from './ml/client.ts';
import { Mailer } from './mail/mailer.ts';
import { HttpHospitalAdapter, MockHospitalAdapter } from './hospital/adapter.ts';
import { bearer, resolveStaff, resolveTablet } from './auth/service.ts';
import { registerRoutes } from './routes/routes.ts';
import { startScheduler } from './jobs/scheduler.ts';
import type { App } from './app.ts';

export async function createApp(cfg: Config): Promise<{ app: App; server: http.Server; stop: () => Promise<void> }> {
  setLogLevel(cfg.logLevel);
  if (cfg.runMigrations) {
    for (let i = 1; ; i++) {
      try {
        await runMigrations(cfg.db);
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (i >= 30 || msg.startsWith('Migrasi')) throw e;
        log.warn('menunggu_database', { attempt: i, error: msg.slice(0, 120) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  const pool = new PgPool(cfg.db, cfg.dbPoolSize);
  const db = new Db(pool, pool);
  const hub = new EventHub();
  const app: App = {
    cfg, pool, db, hub,
    ml: new MlClient(cfg.mlBaseUrl, cfg.mlApiKey, cfg.mlTimeoutMs),
    mailer: new Mailer(cfg),
    rate: new RateLimiter(),
    hospital: cfg.hospitalAdapter === 'http'
      ? new HttpHospitalAdapter(cfg.simrsBaseUrl, cfg.simrsApiKey, cfg.timezone)
      : new MockHospitalAdapter(db, cfg.timezone),
  };

  for (const email of cfg.superadminAllowlist) {
    await db.update("insert into public.superadmin_allowlist (email, note) values (:e, 'SUPERADMIN_ALLOWLIST') on conflict do nothing", { e: email });
  }
  if (!app.mailer.configured) log.warn('smtp_belum_diatur', { hint: 'Isi SMTP_HOST dan MAIL_FROM agar undangan & reset sandi terkirim' });

  const resolveAccess = async (ctx: Ctx, access: Access) => {
    const token = bearer(ctx.req.headers.authorization);
    switch (access.kind) {
      case 'public':
        return;
      case 'cron':
        if (!cfg.cronSecret || !constantTimeEquals(token, cfg.cronSecret)) throw ApiError.unauthorized();
        return;
      case 'tablet': {
        const t = await resolveTablet(app, token);
        if (!t && !access.allowUnregistered) throw ApiError.unauthorized();
        ctx.tablet = t ?? { id: null, deviceCode: null, bedId: null };
        return;
      }
      case 'staff': {
        const s = await resolveStaff(app, token);
        if (access.roles && access.roles.length > 0 && !access.roles.includes(s.role)) throw ApiError.forbidden('Akses ditolak');
        ctx.staff = s;
        return;
      }
      default:
        throw ApiError.forbidden('Endpoint tanpa aturan akses');
    }
  };

  const router = new Router({
    corsOrigins: cfg.corsOrigins,
    maxBodyBytes: Math.ceil(cfg.maxAudioBytes * 1.4) + 64 * 1024,
    resolveAccess,
  });
  registerRoutes(router, app);

  const server = http.createServer((req, res) => {
    router.handle(req, res).catch((e) => {
      log.error('router_gagal', { error: (e as Error).message });
      if (!res.headersSent) { res.statusCode = 500; res.end(); }
    });
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  const listener = new PgListener(cfg.db, ['vocaline_changes']);
  listener.on('notification', ({ payload }: { payload: string }) => {
    try {
      const p = JSON.parse(payload) as { t: string; w: string[] };
      hub.dbChange(p.t, Array.isArray(p.w) ? p.w : []);
    } catch { }
  });
  listener.on('connect_error', (e: Error) => log.warn('listen_gagal', { error: e.message.slice(0, 120) }));
  listener.on('disconnected', () => log.warn('listen_terputus', {}));
  await listener.start();

  const stopScheduler = cfg.schedulerEnabled ? startScheduler(app) : () => undefined;

  const stop = async () => {
    stopScheduler();
    listener.stop();
    hub.close();
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  };
  return { app, server, stop };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const cfg = loadConfig();
  const { server, stop } = await createApp(cfg);
  server.listen(cfg.port, cfg.host, () => log.info('backend_siap', { host: cfg.host, port: cfg.port }));
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      log.info('backend_berhenti', { signal: sig });
      const force = setTimeout(() => process.exit(0), 10_000);
      force.unref();
      stop().then(() => process.exit(0), () => process.exit(1));
    });
  }
  process.on('unhandledRejection', (e) => log.error('unhandled_rejection', { error: String((e as Error)?.message ?? e).slice(0, 200) }));
}
