-- Premium entitlement, set only by the Stripe webhook (service_role) — never
-- writable by the client itself, so upsert_my_profile intentionally does not
-- accept a premium parameter.

alter table public.profiles add column if not exists premium boolean not null default false;
alter table public.profiles add column if not exists premium_purchased_at timestamptz;
