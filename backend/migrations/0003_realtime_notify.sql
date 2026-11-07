create or replace function public.ward_of_bed(p_bed uuid) returns uuid
language sql stable set search_path = public as $$
  select r.ward_id from public.beds b join public.rooms r on r.id = b.room_id where b.id = p_bed
$$;

create or replace function public.notify_change() returns trigger
language plpgsql set search_path = public as $$
declare
  wards uuid[] := '{}';
  t_new uuid;
  t_old uuid;
begin
  if tg_table_name in ('alarms', 'patients', 'meal_schedules') then
    if tg_op <> 'DELETE' then wards := wards || new.ward_id; end if;
    if tg_op <> 'INSERT' then wards := wards || old.ward_id; end if;
  elsif tg_table_name = 'tablets' then
    if tg_op <> 'DELETE' and new.bed_id is not null then wards := wards || public.ward_of_bed(new.bed_id); end if;
    if tg_op <> 'INSERT' and old.bed_id is not null then wards := wards || public.ward_of_bed(old.bed_id); end if;
  elsif tg_table_name = 'tablet_tests' then
    if tg_op <> 'DELETE' then t_new := new.tablet_id; end if;
    if tg_op <> 'INSERT' then t_old := old.tablet_id; end if;
    select coalesce(array_agg(distinct public.ward_of_bed(t.bed_id)) filter (where t.bed_id is not null), '{}')
      into wards from public.tablets t where t.id in (t_new, t_old);
  end if;
  perform pg_notify('vocaline_changes', json_build_object(
    't', tg_table_name, 'op', tg_op,
    'w', (select coalesce(array_agg(distinct x), '{}') from unnest(wards) x where x is not null))::text);
  return null;
end $$;

create trigger alarms_notify         after insert or update or delete on public.alarms         for each row execute function public.notify_change();
create trigger patients_notify       after insert or update or delete on public.patients       for each row execute function public.notify_change();
create trigger tablets_notify        after insert or update or delete on public.tablets        for each row execute function public.notify_change();
create trigger tablet_tests_notify   after insert or update or delete on public.tablet_tests   for each row execute function public.notify_change();
create trigger meal_schedules_notify after insert or update or delete on public.meal_schedules for each row execute function public.notify_change();
