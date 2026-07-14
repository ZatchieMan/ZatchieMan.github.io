// Keeps profiles.premium in sync with the user's Stripe subscription status.
// Deployed with --no-verify-jwt since Stripe is the caller, not a signed-in
// user — authenticity comes from the Stripe signature check below, not a
// Supabase JWT.
//
// Flow:
//   checkout.session.completed  -> first payment. client_reference_id is the
//                                   Supabase user_id (set by the Payment Link
//                                   URL param). Store the Stripe customer/sub
//                                   IDs on that user's profile and mark them
//                                   premium.
//   customer.subscription.updated/deleted -> later lifecycle events (renewal,
//                                   cancellation, payment failure) only carry
//                                   the Stripe customer ID, so we look the
//                                   profile up by stripe_customer_id instead.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function isActiveStatus(status: Stripe.Subscription.Status) {
  return status === "active" || status === "trialing";
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, STRIPE_WEBHOOK_SECRET);
  } catch (e: any) {
    console.error("signature verification failed", e?.message);
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (!userId) {
      console.error("no client_reference_id on session", session.id);
      return new Response(JSON.stringify({ error: "missing client_reference_id" }), { status: 400 });
    }
    const { error } = await supabase.from("profiles")
      .update({
        premium: true,
        premium_purchased_at: new Date().toISOString(),
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
      })
      .eq("user_id", userId);
    if (error) {
      console.error("failed to activate subscription", userId, error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    console.log("subscription activated", userId);
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const active = event.type === "customer.subscription.updated" && isActiveStatus(sub.status);
    const { error } = await supabase.from("profiles")
      .update({ premium: active })
      .eq("stripe_customer_id", sub.customer as string);
    if (error) {
      console.error("failed to update subscription status", sub.customer, error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    console.log("subscription status updated", sub.customer, sub.status, "-> premium:", active);
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
