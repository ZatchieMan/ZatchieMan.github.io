-- Separate dedup column for the weight-log reminder, so it doesn't collide
-- with the workout reminder's last_notified_date on the same day.
alter table push_subscriptions
  add column if not exists last_weight_notified_date date;
