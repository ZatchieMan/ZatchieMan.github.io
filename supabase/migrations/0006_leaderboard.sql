-- Leaderboard: shows the signed-in user's own level/XP alongside their friends'.
-- XP/level are computed client-side (same formula as the in-app level ring) and
-- pushed here via upsert_my_profile — the server never recomputes XP from raw
-- workout data, it just relays whatever each client last reported for itself.

alter table public.profiles add column if not exists xp integer not null default 0;
alter table public.profiles add column if not exists level integer not null default 1;

create or replace function public.upsert_my_profile(p_display_name text default null, p_xp integer default null, p_level integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  insert into public.profiles(user_id, email, display_name, xp, level)
  values (auth.uid(), v_email, nullif(trim(coalesce(p_display_name,'')), ''), coalesce(p_xp,0), coalesce(p_level,1))
  on conflict (user_id) do update
    set email        = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        xp           = coalesce(p_xp, public.profiles.xp),
        level        = coalesce(p_level, public.profiles.level);
end;
$$;

create or replace function public.list_leaderboard()
returns table(user_id uuid, email text, display_name text, xp integer, level integer, is_me boolean)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.email, p.display_name, p.xp, p.level, (p.user_id = auth.uid()) as is_me
  from public.profiles p
  where p.user_id = auth.uid()
     or p.user_id in (
       select case when f.user_a = auth.uid() then f.user_b else f.user_a end
       from public.friendships f
       where f.user_a = auth.uid() or f.user_b = auth.uid()
     )
  order by p.xp desc;
$$;
