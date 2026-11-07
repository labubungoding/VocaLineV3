# VocaLine backend (TypeScript)

Pengganti backend Spring Boot. Node.js 22 menjalankan file `.ts` langsung (type stripping), tanpa
dependensi runtime dan tanpa langkah build.

```
src/
  main.ts              server HTTP, akses per endpoint, LISTEN/NOTIFY → SSE, scheduler, shutdown
  config.ts            environment
  routes/routes.ts     semua endpoint /api/** (kontrak sama dengan controller Java) + auth baru
  services/*.ts        port 1:1 dari service Java (alarm, pasien, tablet, jadwal, denah, admin, snapshot, staf, percakapan)
  auth/                kata sandi (scrypt + verifikasi bcrypt lama via pgcrypto), sesi, undangan, reset
  db/pg.ts             driver PostgreSQL (SCRAM-SHA-256, extended query, pool, transaksi, LISTEN)
  db/db.ts             parameter bernama (:nama), snake_case → camelCase (seperti Db.java)
  db/migrate.ts        menjalankan migrations/*.sql
  mail/                klien SMTP (STARTTLS/TLS, AUTH PLAIN/LOGIN) + template
  realtime/hub.ts      Server-Sent Events (pengganti Supabase Realtime)
  jobs/scheduler.ts    pengganti pg_cron
  ml/client.ts         klien ml-service (kontrak tidak berubah)
  cli.ts               test-email, invite-superadmin, send-reset, list-staff
migrations/            skema PostgreSQL
templates/             email undangan & reset
test/                  unit, SMTP, integrasi API (PostgreSQL sungguhan)
```

Jalankan tanpa Docker (butuh PostgreSQL & variabel di `.env.example` root):

```bash
export DATABASE_URL=postgres://vocaline:sandi@127.0.0.1:5432/vocaline ML_API_KEY=... APP_URL=http://localhost:5173
npm start                 # = node --experimental-strip-types src/main.ts
npm run typecheck         # opsional: npm install (typescript, @types/node) lalu tsc --noEmit
```

## Endpoint tambahan (self-hosted)

| Method | Path | Akses | Body | Respons |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | publik (dibatasi) | `email, password` | `accessToken, tokenType, expiresAt, user` · 401 `invalid_credentials` · 403 `account_disabled`/`email_not_confirmed` · 429 |
| POST | `/api/auth/logout` | staf | — | `ok` |
| POST | `/api/auth/password/check` | publik | `token` | `valid, email?, purpose?` |
| POST | `/api/auth/password/set` | publik | `token, password` | `ok, email` · 422 `weak_password`/`invalid_token` |
| POST | `/api/auth/password/forgot` | publik (dibatasi) | `email` | 202 pesan seragam |
| POST | `/api/auth/password/change` | staf | `currentPassword, newPassword` | `ok` |
| GET | `/api/events` | staf / tablet | — | `text/event-stream` |
| POST | `/api/tablet/register` | publik (dibatasi) | `appVersion?` | 201 `tabletId, deviceCode, deviceToken` (token hanya sekali) |

Semua endpoint lama (`/api/admin/*`, `/api/nurse/*`, `/api/tablet/*`, `/api/compat/*`, `/api/cron/*`,
`/api/health`, `/api/auth/me`, `/api/auth/superadmin/request`) tetap dengan path, method, body, respons,
dan format galat `{ error: { code, message, details? } }` yang sama.
