-- Web Push subscriptions for workout-reminder notifications.
-- One row per device/browser a user has enabled reminders on.
create table if not exists push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  last_notified_date date,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "own rows select" on push_subscriptions
  for select using (auth.uid() = user_id);

create policy "own rows insert" on push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "own rows update" on push_subscriptions
  for update using (auth.uid() = user_id);

create policy "own rows delete" on push_subscriptions
  for delete using (auth.uid() = user_id);
