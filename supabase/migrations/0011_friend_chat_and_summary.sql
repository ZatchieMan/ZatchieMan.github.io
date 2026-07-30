-- Friend chat + friend profile summaries.
--
-- Friend profile summary: profiles already has RLS allowing friends to SELECT
-- each other's full row ("profiles readable to self and friends", see
-- migration history). So exposing PRs/streak/programs to friends just means
-- adding columns here and having the client push them via upsert_my_profile()
-- — no new RPC needed for reads, the existing policy already covers it.
--
-- Chat: a flat messages table between two friends. Realtime is enabled on it
-- so the client can subscribe to new rows for a live chat feel.

alter table public.profiles add column if not exists prs jsonb;
alter table public.profiles add column if not exists streak integer not null default 0;
alter table public.profiles add column if not exists programs_summary jsonb not null default '[]'::jsonb;

create or replace function public.upsert_my_profile(
  p_display_name text default null,
  p_xp integer default null,
  p_level integer default null,
  p_weekly_xp integer default null,
  p_week_start date default null,
  p_prs jsonb default null,
  p_streak integer default null,
  p_programs jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  insert into public.profiles(user_id, email, display_name, xp, level, weekly_xp, week_start, prs, streak, programs_summary)
  values (auth.uid(), v_email, nullif(trim(coalesce(p_display_name,'')), ''), coalesce(p_xp,0), coalesce(p_level,1), coalesce(p_weekly_xp,0), p_week_start, p_prs, coalesce(p_streak,0), coalesce(p_programs,'[]'::jsonb))
  on conflict (user_id) do update
    set email             = excluded.email,
        display_name      = coalesce(excluded.display_name, public.profiles.display_name),
        xp                = coalesce(p_xp, public.profiles.xp),
        level             = coalesce(p_level, public.profiles.level),
        weekly_xp         = coalesce(p_weekly_xp, public.profiles.weekly_xp),
        week_start        = coalesce(p_week_start, public.profiles.week_start),
        prs               = coalesce(p_prs, public.profiles.prs),
        streak            = coalesce(p_streak, public.profiles.streak),
        programs_summary  = coalesce(p_programs, public.profiles.programs_summary);
end;
$$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_from_to_idx on public.messages (from_user, to_user, created_at);
create index if not exists messages_to_from_idx on public.messages (to_user, from_user, created_at);

alter table public.messages enable row level security;

create policy "messages visible to sender and recipient" on public.messages
  for select using (auth.uid() = from_user or auth.uid() = to_user);

create policy "messages insertable by friends only" on public.messages
  for insert with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.friendships f
      where f.user_a = least(auth.uid(), to_user) and f.user_b = greatest(auth.uid(), to_user)
    )
  );

alter publication supabase_realtime add table public.messages;
