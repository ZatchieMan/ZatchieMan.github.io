-- Weekly challenge: tracks each user's XP earned so far in the current
-- (Monday-start, UTC) week, synced by the client the same way xp/level
-- already are. list_weekly_leaderboard() mirrors list_leaderboard()'s
-- friendship-visibility rules, but additionally requires week_start to match
-- the current week — this is what makes stale/inactive friends silently drop
-- off the weekly view instead of showing a leftover number from a prior week.

alter table public.profiles add column if not exists weekly_xp integer not null default 0;
alter table public.profiles add column if not exists week_start date;

create or replace function public.upsert_my_profile(p_display_name text default null, p_xp integer default null, p_level integer default null, p_weekly_xp integer default null, p_week_start date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  insert into public.profiles(user_id, email, display_name, xp, level, weekly_xp, week_start)
  values (auth.uid(), v_email, nullif(trim(coalesce(p_display_name,'')), ''), coalesce(p_xp,0), coalesce(p_level,1), coalesce(p_weekly_xp,0), p_week_start)
  on conflict (user_id) do update
    set email        = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        xp           = coalesce(p_xp, public.profiles.xp),
        level        = coalesce(p_level, public.profiles.level),
        weekly_xp    = coalesce(p_weekly_xp, public.profiles.weekly_xp),
        week_start   = coalesce(p_week_start, public.profiles.week_start);
end;
$$;

create or replace function public.list_weekly_leaderboard()
returns table(user_id uuid, email text, display_name text, weekly_xp integer, level integer, is_me boolean)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.email, p.display_name, p.weekly_xp, p.level, (p.user_id = auth.uid()) as is_me
  from public.profiles p
  where (
      p.user_id = auth.uid()
      or p.user_id in (
        select case when f.user_a = auth.uid() then f.user_b else f.user_a end
        from public.friendships f
        where f.user_a = auth.uid() or f.user_b = auth.uid()
      )
    )
    and p.week_start = ((now() at time zone 'utc')::date - (extract(isodow from (now() at time zone 'utc')::date)::int - 1))
    and p.weekly_xp > 0
  order by p.weekly_xp desc;
$$;
