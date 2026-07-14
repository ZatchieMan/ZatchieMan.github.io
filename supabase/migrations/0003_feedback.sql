-- User feedback submissions, reviewed by the developer via the Supabase table editor.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table feedback enable row level security;

-- Users can submit feedback tied to their own account, but cannot read anyone's
-- submissions back (including their own) — this is a write-only suggestion box.
create policy "insert own feedback" on feedback
  for insert with check (auth.uid() = user_id);
