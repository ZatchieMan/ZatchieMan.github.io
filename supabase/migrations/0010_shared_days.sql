-- Friend-to-friend sharing for standalone days, mirroring shared_programs/
-- send_program_to_friend/list_inbox exactly (see those for the established
-- pattern — this just repeats it for the "day" object shape instead of
-- "program").

create table if not exists public.shared_days (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  name text not null,
  day jsonb not null,
  status text not null default 'unread',
  created_at timestamptz not null default now()
);

alter table public.shared_days enable row level security;

create policy "shared days visible to the two parties" on public.shared_days
  for select using (auth.uid() = to_user or auth.uid() = from_user);

create policy "recipient may update shared day" on public.shared_days
  for update using (auth.uid() = to_user);

create or replace function public.send_day_to_friend(friend_id uuid, p_name text, p_day jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_a uuid; v_b uuid;
begin
  v_a := least(v_me, friend_id); v_b := greatest(v_me, friend_id);
  if not exists (select 1 from public.friendships where user_a = v_a and user_b = v_b) then
    return 'not_friends';
  end if;
  insert into public.shared_days(from_user, to_user, name, day, status)
  values (v_me, friend_id, p_name, p_day, 'unread');
  return 'sent';
end;
$$;

create or replace function public.list_day_inbox()
returns table(id uuid, from_user uuid, email text, display_name text, name text, day jsonb, status text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select s.id, s.from_user, p.email, p.display_name,
         s.name, s.day, s.status, s.created_at
  from public.shared_days s
  join public.profiles p on p.user_id = s.from_user
  where s.to_user = auth.uid() and s.status = 'unread'
  order by s.created_at desc;
$$;
