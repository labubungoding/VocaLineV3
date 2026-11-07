import type { App } from '../app.ts';
import type { Db } from '../db/db.ts';
import { isUniqueViolation } from '../db/db.ts';
import { ApiError } from '../http/errors.ts';
import type { StaffUser } from '../http/router.ts';
import { log } from '../lib/log.ts';
import { revokeAllSessions, sendAccountEmail } from '../auth/service.ts';
import { audit } from './core.ts';

async function invite(app: App, email: string, role: string, fullName: string, username: string | null,
  extra?: (db: Db, id: string) => Promise<void>): Promise<string> {
  const e = email.trim().toLowerCase();
  return app.db.tx(async (db) => {
    if (await db.count('select count(*) from auth.users where lower(email) = :e', { e }) > 0) {
      throw ApiError.conflict('email_taken', 'Email sudah terdaftar');
    }
    const u = await db.one('insert into auth.users (email) values (:e) returning id', { e });
    const id = u!.id as string;
    try {
      await db.update(`insert into public.profiles (id, role, full_name, username, email)
        values (:id, cast(:role as user_role), :name, :username, :email)`, {
        id, role, name: fullName.trim(), username: username == null || username.trim() === '' ? null : username.trim(), email: e,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const c = (err as { constraint?: string }).constraint || '';
        if (c.includes('email')) throw ApiError.conflict('email_taken', 'Email sudah terdaftar');
        throw ApiError.conflict('username_taken', 'Username sudah dipakai');
      }
      throw err;
    }
    if (extra) await extra(db, id);
    await sendAccountEmail(app, db, id, true);
    return id;
  });
}

export async function requestSuperadminAccess(app: App, email: string) {
  const e = email.trim().toLowerCase();
  const allowed = await app.db.count('select count(*) from public.superadmin_allowlist where lower(email) = :e', { e }) > 0;
  const exists = await app.db.count('select count(*) from public.profiles where lower(email) = :e', { e }) > 0;
  if (allowed && !exists) {
    try {
      await invite(app, e, 'superadmin', 'Admin RS', null);
      await audit(app.db, 'system', null, 'superadmin.invite', e);
    } catch (err) {
      log.warn('undangan_superadmin_gagal', { error: (err as Error).name, code: (err as ApiError).code });
    }
  }
  return { message: 'Jika email terdaftar sebagai email rumah sakit, tautan verifikasi sudah dikirim.' };
}

export async function me(app: App, s: StaffUser) {
  const wards = s.wardIds.length === 0 ? []
    : await app.db.list('select id, name from public.wards where id in (:ids) order by name', { ids: s.wardIds });
  return {
    id: s.id, role: s.role, loginOption: s.role === 'superadmin' ? 'superadmin' : 'admin',
    homePath: s.role === 'superadmin' ? '/admin' : '/nurse', fullName: s.fullName, email: s.email, wards,
  };
}

export async function listNurses(app: App, q: string | null) {
  let filter = '';
  let like: string | null = null;
  if (q != null && q.trim() !== '') {
    filter = ' and (p.full_name ilike :q or p.email ilike :q or p.username ilike :q)';
    like = `%${q.trim().replace(/%/g, '').replace(/_/g, '\\_')}%`;
  }
  return app.db.list(`
    select p.id, p.full_name, p.username, p.email, p.is_active, p.activated_at,
           coalesce(json_agg(json_build_object('id', w.id, 'name', w.name) order by w.name)
                    filter (where w.id is not null), '[]') as wards
    from public.profiles p
    left join public.nurse_wards nw on nw.nurse_id = p.id
    left join public.wards w on w.id = nw.ward_id
    where p.role = 'nurse'${filter}
    group by p.id
    order by p.full_name`, { q: like });
}

async function setWards(db: Db, nurseId: string, wardIds: string[]) {
  await db.update('delete from public.nurse_wards where nurse_id = :n', { n: nurseId });
  for (const w of wardIds) {
    await db.update('insert into public.nurse_wards (nurse_id, ward_id) values (:n, :w) on conflict do nothing', { n: nurseId, w });
  }
}

export async function createNurse(app: App, admin: StaffUser, b: { fullName: string; email: string; username: string; wardIds: string[] }) {
  let id: string;
  try {
    id = await invite(app, b.email, 'nurse', b.fullName, b.username, (db, newId) => setWards(db, newId, b.wardIds));
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw ApiError.notFound('Bangsal');
    throw e;
  }
  await audit(app.db, 'superadmin', admin.id, 'nurse.create', id, { wards: b.wardIds.length });
  return { id, invited: true };
}

export async function updateNurse(app: App, admin: StaffUser, id: string, b: { fullName: string | null; username: string | null; wardIds: string[] | null }) {
  try {
    await app.db.update(`update public.profiles set full_name = coalesce(:name, full_name), username = coalesce(:u, username)
      where id = :id and role = 'nurse'`, { name: b.fullName == null ? null : b.fullName.trim(), u: b.username == null ? null : b.username.trim(), id });
  } catch (e) {
    if (isUniqueViolation(e)) throw ApiError.conflict('username_taken', 'Username sudah dipakai');
    throw e;
  }
  if (b.wardIds != null) await setWards(app.db, id, b.wardIds);
  await audit(app.db, 'superadmin', admin.id, 'nurse.update', id);
  return { id };
}

export async function setActive(app: App, admin: StaffUser, id: string, active: boolean) {
  const n = await app.db.update("update public.profiles set is_active = :a where id = :id and role = 'nurse'", { a: active, id });
  if (n === 0) throw ApiError.notFound('Akun perawat');
  await app.db.update(`update auth.users set banned_until = ${active ? 'null' : "'infinity'"} where id = :id`, { id });
  if (!active) {
    await revokeAllSessions(app, app.db, id);
    await app.db.update(`update public.alarms set status = 'waiting', handled_by = null, handled_at = null
      where handled_by = :id and status = 'handling'`, { id });
  }
  await audit(app.db, 'superadmin', admin.id, active ? 'nurse.activate' : 'nurse.deactivate', id);
  return { id, active };
}

export async function sendPasswordReset(app: App, admin: StaffUser, id: string) {
  const p = await app.db.one('select email from public.profiles where id = :id', { id });
  if (!p) throw ApiError.notFound('Akun');
  await sendAccountEmail(app, app.db, id, true);
  await audit(app.db, 'superadmin', admin.id, 'nurse.reset_password', id);
  return { sent: true };
}
