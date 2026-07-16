// Permanently deletes the signed-in user's account and every row of data
// associated with it. Deployed WITH JWT verification (the default) since
// this is a user-facing, highly destructive endpoint — the caller must be a
// signed-in Supabase user, identified from their own access token.
//
// This schema has no FK cascades from auth.users, so every table is cleaned
// explicitly before the auth.users row itself is removed via the Admin API.
// Any active Stripe subscription is canceled first so deleting the account
// can't leave someone being billed forever with no way to stop it.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "not signed in" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = user.id;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile } = await admin.from("profiles")
      .select("stripe_subscription_id").eq("user_id", uid).maybeSingle();
    if (profile?.stripe_subscription_id) {
      try { await stripe.subscriptions.cancel(profile.stripe_subscription_id); }
      catch (e: any) { console.warn("stripe cancel failed (may already be canceled)", e?.message); }
    }

    await admin.from("analytics_events").delete().eq("user_id", uid);
    await admin.from("feedback").delete().eq("user_id", uid);
    await admin.from("friend_requests").delete().or(`from_user.eq.${uid},to_user.eq.${uid}`);
    await admin.from("friendships").delete().or(`user_a.eq.${uid},user_b.eq.${uid}`);
    await admin.from("shared_programs").delete().or(`from_user.eq.${uid},to_user.eq.${uid}`);
    await admin.from("push_subscriptions").delete().eq("user_id", uid);
    await admin.from("user_data").delete().eq("user_id", uid);
    await admin.from("profiles").delete().eq("user_id", uid);

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("delete-account failed", e?.message);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
