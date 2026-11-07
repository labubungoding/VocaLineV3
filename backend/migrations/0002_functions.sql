create or replace function public.handle_staff_confirmed() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles set activated_at = now() where id = new.id and activated_at is null;
  end if;
  return new;
end $$;

create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_staff_confirmed();

create or replace function public.persona_for_age(p_age int) returns public.persona_key
language sql stable set search_path = public as $$
  select case
    when p_age between s.age_min_teen  and s.age_max_teen  then 'remaja'::public.persona_key
    when p_age between s.age_min_adult and s.age_max_adult then 'dewasa'::public.persona_key
    when p_age >= s.age_min_elder                          then 'lansia'::public.persona_key
    else null end
  from public.hospital_settings s where s.id = 1
$$;

create or replace function public.claim_alarm(p_alarm uuid, p_nurse uuid)
returns public.alarms language plpgsql set search_path = public as $$
declare v public.alarms;
begin
  update public.alarms
     set status = 'handling', handled_by = p_nurse, handled_at = now()
   where id = p_alarm and status = 'waiting'
  returning * into v;
  if not found then
    select * into v from public.alarms where id = p_alarm;
  end if;
  return v;
end $$;

create or replace view public.bed_states with (security_invoker = true) as
select
  b.id   as bed_id,
  b.code as bed_code,
  b.number as bed_number,
  r.id   as room_id,
  r.number as room_number,
  r.ward_id,
  t.id   as tablet_id,
  t.status as tablet_status,
  t.ai_enabled,
  p.id   as patient_id,
  case
    when t.id is null or t.disabled_at is not null then 'no-tablet'
    when p.id is null then 'empty'
    when exists (select 1 from public.alarms a where a.bed_id = b.id and a.status = 'waiting' and a.level = 'red')    then 'red'
    when exists (select 1 from public.alarms a where a.bed_id = b.id and a.status = 'waiting' and a.level = 'orange') then 'orange'
    when exists (select 1 from public.alarms a where a.bed_id = b.id and a.status = 'handling' and a.level <> 'test') then 'handling'
    else 'green'
  end as bed_state
from public.beds b
join public.rooms r on r.id = b.room_id
left join public.tablets t  on t.bed_id = b.id
left join public.patients p on p.bed_id = b.id;

create or replace function public.escalate_alarms() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  update public.alarms a
     set escalated = true, escalated_at = now()
    from public.hospital_settings s
   where s.id = 1 and a.status = 'waiting' and not a.escalated
     and (   (a.level = 'red'    and a.created_at < now() - make_interval(mins => s.escalation_red_minutes))
          or (a.level = 'orange' and a.created_at < now() - make_interval(mins => s.escalation_orange_minutes)));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mark_offline_tablets() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  update public.tablets set status = 'offline'
   where status <> 'offline' and (last_seen_at is null or last_seen_at < now() - interval '2 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.claim_due_meal_schedules(p_tz text default 'Asia/Jakarta')
returns setof public.meal_schedules
language plpgsql set search_path = public as $$
declare v_now timestamp := now() at time zone p_tz;
begin
  return query
  update public.meal_schedules m
     set last_fired_on = v_now::date
   where m.is_active
     and (m.last_fired_on is null or m.last_fired_on < v_now::date)
     and m.time_of_day <= v_now::time
     and m.time_of_day >  (v_now - interval '10 minutes')::time
  returning m.*;
end $$;

create or replace view public.alarm_log_anonymous as
select
  a.id, a.created_at, a.level, a.status, a.source, a.escalated,
  w.id as ward_id, w.name as ward_name, r.number as room_number, b.number as bed_number,
  extract(epoch from (a.handled_at  - a.created_at))::int as seconds_to_handle,
  extract(epoch from (a.resolved_at - a.created_at))::int as seconds_to_resolve
from public.alarms a
join public.beds b  on b.id = a.bed_id
join public.rooms r on r.id = b.room_id
join public.wards w on w.id = a.ward_id
where a.level <> 'test';

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger patients_touch before update on public.patients for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.hospital_settings for each row execute function public.touch_updated_at();
create trigger users_touch before update on auth.users for each row execute function public.touch_updated_at();

create or replace function public.vocaline_cleanup() returns jsonb
language plpgsql set search_path = public as $$
declare a int; t int; s int; k int;
begin
  delete from public.audit_log where created_at < now() - interval '180 days';
  get diagnostics a = row_count;
  delete from public.tablets where bed_id is null and paired_at is null and created_at < now() - interval '7 days';
  get diagnostics t = row_count;
  delete from auth.sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days';
  get diagnostics s = row_count;
  delete from auth.tokens where expires_at < now() - interval '30 days';
  get diagnostics k = row_count;
  return jsonb_build_object('audit_log', a, 'tablets', t, 'sessions', s, 'tokens', k);
end $$;
