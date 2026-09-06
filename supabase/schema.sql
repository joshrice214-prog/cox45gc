-- Cox 45™ schema. Run once in the Supabase SQL editor.
-- No auth: the anon key gets full access. This is four friends, not the public.

create extension if not exists "pgcrypto";

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  first_name text,
  last_name text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  holes int not null default 18 check (holes in (9, 18)),
  pars int[] not null default '{}',
  stroke_index int[] not null default '{}',
  course_rating numeric(4,1),
  slope int check (slope is null or (slope between 55 and 155)),
  created_at timestamptz not null default now(),
  unique (name, holes)   -- the same course can have an 18-hole and a 9-hole card
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete set null,
  course_name text,
  date date not null,
  time text,
  note text,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete restrict,
  date date not null,
  holes int not null check (holes in (9, 18)),
  course_rating numeric(4,1),   -- snapshot at time of round
  slope int,                    -- snapshot at time of round
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rounds_date_idx on rounds(date);

create table if not exists round_scores (
  round_id uuid not null references rounds(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  hole_scores int[] not null default '{}',   -- raw gross, pre-cap; null entries allowed
  gross_total int not null,
  primary key (round_id, player_id)
);

create table if not exists handicap_snapshots (
  player_id uuid not null references players(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  date date not null,
  world_index numeric(4,1),
  pro_index numeric(4,1),
  cox_index numeric(4,1),
  tier text not null default 'cox45' check (tier in ('cox45','pro','whs')),
  primary key (player_id, round_id)
);
-- for installs created before the ladder existed
alter table handicap_snapshots add column if not exists pro_index numeric(4,1);
alter table handicap_snapshots add column if not exists tier text not null default 'cox45';

create table if not exists rsvps (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null check (status in ('in','maybe','out')),
  primary key (event_id, player_id)
);

create table if not exists availability (
  player_id uuid not null references players(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  dates date[] not null default '{}',
  primary key (player_id, month)
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade,
  endpoint text not null unique,
  subscription_json jsonb not null,
  created_at timestamptz not null default now()
);

-- Starting roster
insert into players (name, first_name) values ('Josh','Josh'), ('Owen','Owen'), ('Matt','Matt'), ('Ed','Ed')
on conflict (name) do nothing;

-- Open access for the anon key (no login by design)
do $$
declare t text;
begin
  foreach t in array array['players','courses','events','rounds','round_scores','handicap_snapshots','rsvps','availability','push_subscriptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon all" on %I', t);
    execute format('create policy "anon all" on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

-- Profile photos
insert into storage.buckets (id, name, public) values ('avatars','avatars', true)
on conflict (id) do nothing;
drop policy if exists "avatars anon all" on storage.objects;
create policy "avatars anon all" on storage.objects for all to anon
  using (bucket_id = 'avatars') with check (bucket_id = 'avatars');
