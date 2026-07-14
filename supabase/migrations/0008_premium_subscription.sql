-- Switches premium from a one-time flag to a subscription-backed one.
-- profiles.premium now means "subscription currently active" (kept in sync by
-- the stripe-webhook function from subscription lifecycle events), not a
-- permanent purchase flag. stripe_customer_id lets the client open a Stripe
-- Customer Portal session to manage/cancel their own subscription.

alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
create index if not exists profiles_stripe_customer_id_idx on public.profiles(stripe_customer_id);
