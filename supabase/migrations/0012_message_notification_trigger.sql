-- Fires the send-message-notification Edge Function whenever a chat message
-- is inserted, so recipients get a push notification immediately rather than
-- waiting on a polling schedule. Mirrors the 0005 welcome-email trigger
-- pattern: a trusted internal database-to-function call.

create or replace function public.handle_new_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://ilmnuygckesuimmfxuqz.supabase.co/functions/v1/send-message-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('message_id', new.id, 'from_user', new.from_user, 'to_user', new.to_user, 'body', new.body)
  );
  return new;
end;
$$;

drop trigger if exists on_message_insert_notify on public.messages;
create trigger on_message_insert_notify
  after insert on public.messages
  for each row execute function public.handle_new_message_notification();
