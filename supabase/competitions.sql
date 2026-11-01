-- Shared daily topic standings for authenticated LeetComp users.
-- Run this migration in the Supabase SQL Editor. Re-running it updates the leaderboard functions safely.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_ci on public.profiles (lower(username));
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
drop policy if exists "Players read their own profile" on public.profiles;
create policy "Players read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Players create their own profile" on public.profiles;
create policy "Players create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Players update their own profile" on public.profiles;
create policy "Players update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create table if not exists public.competition_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  competition_day date not null,
  topic text not null,
  problem_id text not null,
  state text not null default 'live' check (state in ('live', 'done')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  accepted boolean,
  passed integer,
  total integer,
  runtime_ms double precision check (runtime_ms is null or runtime_ms >= 0),
  memory_mb double precision check (memory_mb is null or memory_mb >= 0),
  verdict text,
  unique (user_id, competition_day, topic)
);

create index if not exists ix_competition_attempts_board
  on public.competition_attempts (competition_day, topic, submitted_at);
alter table public.competition_attempts enable row level security;
revoke all on public.competition_attempts from anon, authenticated;
grant select, insert, update on public.competition_attempts to authenticated;
drop policy if exists "Players read their own entries" on public.competition_attempts;
create policy "Players read their own entries" on public.competition_attempts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players create their own entries" on public.competition_attempts;
create policy "Players create their own entries" on public.competition_attempts
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players update their own entries" on public.competition_attempts;
create policy "Players update their own entries" on public.competition_attempts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.get_topic_leaderboard(p_day date, p_topic text)
returns table (
  attempt_id uuid, user_id uuid, username text, state text, accepted boolean,
  submitted_at timestamptz, runtime_ms double precision, memory_mb double precision,
  passed integer, total integer, verdict text, time_pct double precision,
  space_pct double precision, score double precision, rank bigint, entrants bigint
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with field as (
    select a.* from public.competition_attempts a
    where a.competition_day = p_day and a.topic = p_topic
  ), accepted as (
    select f.*,
      count(*) over () as accepted_count,
      rank() over (order by f.runtime_ms asc nulls last) as runtime_rank,
      count(*) over (partition by f.runtime_ms) as runtime_ties,
      rank() over (order by f.memory_mb asc nulls last) as memory_rank,
      count(*) over (partition by f.memory_mb) as memory_ties
    from field f where f.state = 'done' and f.accepted is true
  ), scored as (
    select a.*,
      case when accepted_count = 1 and runtime_ms is not null then 100::double precision
           when accepted_count <= 1 or runtime_ms is null then 0::double precision
           else (accepted_count - runtime_rank - (runtime_ties - 1) / 2.0) * 100.0 / (accepted_count - 1) end as tp,
      case when accepted_count = 1 and memory_mb is not null then 100::double precision
           when accepted_count <= 1 or memory_mb is null then 0::double precision
           else (accepted_count - memory_rank - (memory_ties - 1) / 2.0) * 100.0 / (accepted_count - 1) end as sp
    from accepted a
  ), ranked as (
    select s.*, (s.tp + s.sp) / 2.0 as points,
      rank() over (order by (s.tp + s.sp) desc) as place
    from scored s
  )
  select f.id, f.user_id, f.username, f.state, f.accepted, f.submitted_at,
    f.runtime_ms, f.memory_mb, f.passed, f.total, f.verdict,
    r.tp, r.sp, r.points, r.place, (select count(*) from field)
  from field f left join ranked r on r.id = f.id
  order by r.place nulls last, f.submitted_at, f.username;
$$;
revoke all on function public.get_topic_leaderboard(date, text) from public, anon;
grant execute on function public.get_topic_leaderboard(date, text) to authenticated;

create or replace function public.get_my_competition_wins()
returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  with accepted as (
    select a.*,
      count(*) over (partition by a.competition_day,a.topic) as n,
      rank() over (partition by a.competition_day,a.topic order by a.runtime_ms asc nulls last) as tr,
      count(*) over (partition by a.competition_day,a.topic,a.runtime_ms) as tt,
      rank() over (partition by a.competition_day,a.topic order by a.memory_mb asc nulls last) as mr,
      count(*) over (partition by a.competition_day,a.topic,a.memory_mb) as mt
    from public.competition_attempts a
    where a.state='done' and a.accepted is true
  ), scored as (
    select a.*,
      case when n=1 and runtime_ms is not null then 100::double precision
           when n<=1 or runtime_ms is null then 0::double precision else (n-tr-(tt-1)/2.0)*100.0/(n-1) end as tp,
      case when n=1 and memory_mb is not null then 100::double precision
           when n<=1 or memory_mb is null then 0::double precision else (n-mr-(mt-1)/2.0)*100.0/(n-1) end as sp
    from accepted a
  ), ranked as (
    select s.*,rank() over (partition by competition_day,topic order by (tp+sp) desc) as place
    from scored s
  )
  select count(*) from ranked
  where user_id=auth.uid() and competition_day<(now() at time zone 'UTC')::date and place=1;
$$;
revoke all on function public.get_my_competition_wins() from public, anon;
grant execute on function public.get_my_competition_wins() to authenticated;

create or replace function public.get_my_latest_win()
returns table (competition_day date, topic text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with accepted as (
    select a.*,
      count(*) over (partition by a.competition_day,a.topic) as n,
      rank() over (partition by a.competition_day,a.topic order by a.runtime_ms asc nulls last) as tr,
      count(*) over (partition by a.competition_day,a.topic,a.runtime_ms) as tt,
      rank() over (partition by a.competition_day,a.topic order by a.memory_mb asc nulls last) as mr,
      count(*) over (partition by a.competition_day,a.topic,a.memory_mb) as mt
    from public.competition_attempts a
    where a.state='done' and a.accepted is true
  ), scored as (
    select a.*,
      case when n=1 and runtime_ms is not null then 100::double precision
           when n<=1 or runtime_ms is null then 0::double precision else (n-tr-(tt-1)/2.0)*100.0/(n-1) end as tp,
      case when n=1 and memory_mb is not null then 100::double precision
           when n<=1 or memory_mb is null then 0::double precision else (n-mr-(mt-1)/2.0)*100.0/(n-1) end as sp
    from accepted a
  ), ranked as (
    select s.*,rank() over (partition by competition_day,topic order by (tp+sp) desc) as place
    from scored s
  )
  select competition_day,topic from ranked
  where user_id=auth.uid() and competition_day<(now() at time zone 'UTC')::date and place=1
  order by competition_day desc limit 1;
$$;
revoke all on function public.get_my_latest_win() from public, anon;
grant execute on function public.get_my_latest_win() to authenticated;
