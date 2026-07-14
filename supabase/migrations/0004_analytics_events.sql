-- Lightweight custom product-analytics events, queried directly via SQL/table editor.
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table analytics_events enable row level security;

-- Write-only from the client, same pattern as feedback — users can log their own
-- events but can't read anyone's (including their own) back through the app.
create policy "insert own events" on analytics_events
  for insert with check (auth.uid() = user_id);

create index if not exists analytics_events_event_name_idx on analytics_events(event_name);
create index if not exists analytics_events_created_at_idx on analytics_events(created_at);
