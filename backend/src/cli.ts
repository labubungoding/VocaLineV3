import { loadConfig } from './config.ts';
import { PgPool } from './db/pg.ts';
import { Db } from './db/db.ts';
import { Mailer } from './mail/mailer.ts';
import { EventHub } from './realtime/hub.ts';
import { MlClient } from './ml/client.ts';
import { RateLimiter } from './lib/util.ts';
import { MockHospitalAdapter } from './hospital/adapter.ts';
import { sendAccountEmail } from './auth/service.ts';
import type { App } from './app.ts';

const [cmd, arg1, arg2] = process.argv.slice(2);
const cfg = loadConfig();
const pool = new PgPool(cfg.db, 2);
const db = new Db(pool, pool);
const hub = new EventHub();
const app: App = { cfg, pool, db, hub, ml: new MlClient(cfg.mlBaseUrl, cfg.mlApiKey, cfg.mlTimeoutMs), mailer: new Mailer(cfg),
  rate: new RateLimiter(), hospital: new MockHospitalAdapter(db, cfg.timezone) };

async function main() {
  switch (cmd) {
    case 'test-email': {
      if (!arg1) throw new Error('Pemakaian: test-email alamat@domain');
      await app.mailer.sendTest(arg1);
      console.log(`Email uji terkirim ke ${arg1} lewat ${cfg.smtp.host}:${cfg.smtp.port} (${cfg.smtp.secure}).`);
      break;
    }
    case 'invite-superadmin': {
      if (!arg1) throw new Error('Pemakaian: invite-superadmin email [nama]');
      const email = arg1.trim().toLowerCase();
      await db.tx(async (t) => {
        await t.update("insert into public.superadmin_allowlist (email, note) values (:e, 'cli') on conflict do nothing", { e: email });
        if (await t.count('select count(*) from auth.users where lower(email) = :e', { e: email }) > 0) {
          throw new Error('Email sudah punya akun. Pakai: send-reset');
        }
        const u = await t.one('insert into auth.users (email) values (:e) returning id', { e: email });
        await t.update("insert into public.profiles (id, role, full_name, email) values (:id, 'superadmin', :n, :e)",
          { id: u!.id, n: arg2 || 'Admin RS', e: email });
        await sendAccountEmail(app, t, u!.id, true);
      });
      console.log(`Undangan superadmin dikirim ke ${email}. Buka tautan di email untuk membuat kata sandi.`);
      break;
    }
    case 'send-reset': {
      if (!arg1) throw new Error('Pemakaian: send-reset email');
      const u = await db.one('select id from auth.users where lower(email) = :e', { e: arg1.trim().toLowerCase() });
      if (!u) throw new Error('Akun tidak ditemukan');
      const purpose = await sendAccountEmail(app, db, u.id, true);
      console.log(`Email ${purpose === 'invite' ? 'undangan' : 'reset kata sandi'} dikirim ke ${arg1}.`);
      break;
    }
    case 'list-staff': {
      const rows = await db.list(`select p.email, p.role::text as role, p.is_active,
        u.email_confirmed_at is not null as verified, u.password_hash is not null as has_password,
        coalesce(u.password_hash like 'scrypt$%', false) as scrypt, u.legacy_source
        from public.profiles p join auth.users u on u.id = p.id order by p.role, p.email`);
      console.table(rows);
      break;
    }
    default:
      console.log('Perintah: test-email <to> | invite-superadmin <email> [nama] | send-reset <email> | list-staff');
      process.exitCode = 1;
  }
}

try {
  await main();
} catch (e) {
  console.error(`GAGAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  hub.close();
  await pool.end();
}
