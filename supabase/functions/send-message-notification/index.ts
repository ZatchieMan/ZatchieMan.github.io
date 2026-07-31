// Sends a Web Push notification to a chat message's recipient. Invoked
// directly by a database trigger on public.messages (see migration
// 0012_message_notification_trigger.sql), so it fires immediately on send
// rather than waiting on a polling schedule like send-workout-reminders.
//
// Only sends if the recipient has opted into message notifications
// (data.profile.messageNotifications.enabled in their user_data row) and has
// at least one active push subscription.
//
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Deployed with --no-verify-jwt since the caller is our own database trigger,
// not a signed-in user.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  const { from_user, to_user, body } = await req.json();
  if (!from_user || !to_user || !body) {
    return new Response(JSON.stringify({ error: "missing fields" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: recipientRow, error: recipientErr } = await supabase
    .from("user_data")
    .select("data")
    .eq("user_id", to_user)
    .maybeSingle();
  if (recipientErr) {
    console.error("recipient lookup failed", recipientErr);
    return new Response(JSON.stringify({ error: recipientErr.message }), { status: 500 });
  }
  const enabled = !!recipientRow?.data?.profile?.messageNotifications?.enabled;
  if (!enabled) {
    return new Response(JSON.stringify({ sent: 0, reason: "not opted in" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("user_id", from_user)
    .maybeSingle();
  const senderName = senderProfile?.display_name || senderProfile?.email || "Someone";

  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", to_user);
  if (subErr || !subs || !subs.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const preview = body.length > 120 ? body.slice(0, 117) + "…" : body;
  const payload = JSON.stringify({
    title: `New message from ${senderName}`,
    body: preview,
    tag: `message-${from_user}`,
  });

  let sent = 0;
  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await webpush.sendNotification(pushSub, payload);
      sent++;
    } catch (e: any) {
      const status = e?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("user_id", to_user).eq("endpoint", sub.endpoint);
      } else {
        console.error("push failed", to_user, status, e?.message);
      }
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
