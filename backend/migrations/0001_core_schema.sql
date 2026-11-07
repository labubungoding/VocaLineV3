create extension if not exists pgcrypto;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text,
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  failed_attempts    int not null default 0,
  locked_until       timestamptz,
  last_sign_in_at    timestamptz,
  password_changed_at timestamptz,
  legacy_source      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index users_email_lower_idx on auth.users (lower(email));

create table auth.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
create index sessions_user_idx on auth.sessions (user_id);

create table auth.tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  purpose    text not null check (purpose in ('invite', 'recovery')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index tokens_user_idx on auth.tokens (user_id, purpose);

create type public.user_role      as enum ('superadmin', 'nurse');
create type public.persona_key    as enum ('remaja', 'dewasa', 'lansia');
create type public.alarm_level    as enum ('red', 'orange', 'test');
create type public.alarm_status   as enum ('waiting', 'handling', 'done', 'cancelled');
create type public.alarm_source   as enum ('ai_voice', 'emergency_button', 'call_nurse_button', 'unclear_speech', 'nurse_test', 'offline_queue');
create type public.tablet_status  as enum ('online', 'offline', 'low-battery');
create type public.meal_type      as enum ('makan_pagi', 'makan_siang', 'makan_malam', 'kunjungan_dokter', 'lainnya');
create type public.test_kind      as enum ('mic', 'speaker', 'alarm');
create type public.test_status    as enum ('idle', 'pending', 'pass', 'fail');

create table public.hospital_settings (
  id                       smallint primary key default 1 check (id = 1),
  hospital_name            text not null default 'Rumah Sakit',
  age_min_teen             int  not null default 13,
  age_max_teen             int  not null default 17,
  age_min_adult            int  not null default 18,
  age_max_adult            int  not null default 59,
  age_min_elder            int  not null default 60,
  escalation_red_minutes   int  not null default 1 check (escalation_red_minutes between 1 and 60),
  escalation_orange_minutes int not null default 5 check (escalation_orange_minutes between 1 and 120),
  low_battery_percent      int  not null default 20,
  setup_completed_at       timestamptz,
  updated_at               timestamptz not null default now(),
  constraint age_ranges_ok check (
    age_min_teen <= age_max_teen and age_max_teen < age_min_adult
    and age_min_adult <= age_max_adult and age_max_adult < age_min_elder)
);
insert into public.hospital_settings (id) values (1);

create table public.wards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  floor_label text,
  created_at  timestamptz not null default now()
);

create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references public.wards(id) on delete restrict,
  number     text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (ward_id, number)
);

create table public.beds (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete restrict,
  number     text not null,
  code       text not null unique,
  created_at timestamptz not null default now(),
  unique (room_id, number)
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        public.user_role not null,
  full_name   text not null,
  username    text unique,
  email       text not null unique,
  is_active   boolean not null default true,
  invited_at  timestamptz not null default now(),
  activated_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.nurse_wards (
  nurse_id uuid not null references public.profiles(id) on delete cascade,
  ward_id  uuid not null references public.wards(id) on delete cascade,
  primary key (nurse_id, ward_id)
);

create table public.superadmin_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

create table public.tablets (
  id             uuid primary key default gen_random_uuid(),
  device_code    text not null unique,
  auth_user_id   uuid unique,
  device_token_hash text unique,
  label          text,
  bed_id         uuid unique references public.beds(id) on delete set null,
  paired_at      timestamptz,
  paired_by      uuid references public.profiles(id) on delete set null,
  status         public.tablet_status not null default 'offline',
  battery_level  int check (battery_level between 0 and 100),
  is_charging    boolean,
  ai_enabled     boolean not null default true,
  app_version    text,
  last_seen_at   timestamptz,
  disabled_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index tablets_last_seen_idx on public.tablets (last_seen_at);

create table public.tablet_tests (
  id          uuid primary key default gen_random_uuid(),
  tablet_id   uuid not null references public.tablets(id) on delete cascade,
  kind        public.test_kind not null,
  status      public.test_status not null default 'pending',
  detail      text,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table public.patients (
  id                  uuid primary key default gen_random_uuid(),
  bed_id              uuid not null unique references public.beds(id) on delete restrict,
  ward_id             uuid not null references public.wards(id) on delete restrict,
  hospital_patient_id text not null,
  full_name           text not null,
  nickname            text not null check (char_length(nickname) <= 30),
  age                 int  not null check (age between 0 and 130),
  diagnosis           text not null,
  persona             public.persona_key not null,
  activated_by        uuid references public.profiles(id) on delete set null,
  activated_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index patients_ward_idx on public.patients (ward_id);

create table public.patient_context (
  patient_id    uuid primary key references public.patients(id) on delete cascade,
  allergies     text[] not null default '{}',
  history       jsonb  not null default '[]',
  preferences   jsonb  not null default '{}',
  source        text   not null default 'simrs',
  fetched_at    timestamptz not null default now()
);

create table public.alarms (
  id              uuid primary key default gen_random_uuid(),
  bed_id          uuid not null references public.beds(id) on delete restrict,
  ward_id         uuid not null references public.wards(id) on delete restrict,
  patient_id      uuid references public.patients(id) on delete set null,
  tablet_id       uuid references public.tablets(id) on delete set null,
  level           public.alarm_level not null,
  status          public.alarm_status not null default 'waiting',
  source          public.alarm_source not null,
  summary         text,
  client_alarm_id uuid unique,
  escalated       boolean not null default false,
  escalated_at    timestamptz,
  handled_by      uuid references public.profiles(id) on delete set null,
  handled_at      timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index alarms_ward_open_idx on public.alarms (ward_id, status) where status in ('waiting', 'handling');
create index alarms_created_idx   on public.alarms (created_at);
create unique index alarms_one_open_per_bed_level
  on public.alarms (bed_id, level) where status in ('waiting', 'handling');

create table public.meal_schedules (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references public.wards(id) on delete cascade,
  room_id       uuid references public.rooms(id) on delete cascade,
  time_of_day   time not null,
  type          public.meal_type not null,
  extra_message text check (char_length(extra_message) <= 200),
  is_active     boolean not null default true,
  last_fired_on date,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.service_status (
  name       text primary key,
  ok         boolean not null,
  detail     jsonb not null default '{}',
  checked_at timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  actor_kind text not null,
  action     text not null,
  target     text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.mock_simrs_patients (
  hospital_patient_id text primary key,
  full_name text not null,
  birth_date date not null,
  diagnosis text not null,
  allergies text[] default '{}',
  history jsonb default '[]'
);
