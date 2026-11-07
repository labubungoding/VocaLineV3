import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgConnection, type PgConfig } from './pg.ts';
import { log } from '../lib/log.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(cfg: PgConfig, dir = DIR): Promise<string[]> {
  const c = new PgConnection({ ...cfg, applicationName: 'vocaline-migrate', statementTimeoutMs: undefined });
  await c.connect();
  const applied: string[] = [];
  try {
    await c.simple('select pg_advisory_lock(727274)');
    await c.simple(`create table if not exists public.schema_migrations (
      version text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await c.query('select version from public.schema_migrations')).rows.map((r) => String(r.version)));
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        await c.simple(`BEGIN;\n${sql}\n;insert into public.schema_migrations(version) values ('${f.replace(/'/g, "''")}');\nCOMMIT;`);
      } catch (e) {
        await c.simple('ROLLBACK').catch(() => undefined);
        throw new Error(`Migrasi ${f} gagal: ${(e as Error).message}`);
      }
      applied.push(f);
      log.info('migrasi_diterapkan', { file: f });
    }
    await c.simple('select pg_advisory_unlock(727274)');
  } finally {
    c.close();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import('../config.ts');
  const cfg = loadConfig();
  const applied = await runMigrations(cfg.db);
  console.log(applied.length ? `Diterapkan: ${applied.join(', ')}` : 'Database sudah terbaru');
}
