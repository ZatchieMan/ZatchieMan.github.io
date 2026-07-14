-- Fires the send-welcome-email Edge Function whenever a new user signs up.
-- The function is deployed with --no-verify-jwt since this is a trusted,
-- internal database-to-function call, not a user-facing endpoint.
create or replace function public.handle_new_user_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://ilmnuygckesuimmfxuqz.supabase.co/functions/v1/send-welcome-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('email', new.email)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_send_welcome_email on auth.users;
create trigger on_auth_user_created_send_welcome_email
  after insert on auth.users
  for each row execute function public.handle_new_user_welcome_email();
