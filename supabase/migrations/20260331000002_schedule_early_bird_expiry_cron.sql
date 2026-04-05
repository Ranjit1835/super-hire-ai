-- Schedule daily job to expire early bird subscriptions past their expiry date
-- Runs at midnight UTC every day
SELECT cron.schedule(
  'expire-early-bird-subscriptions',
  '0 0 * * *',
  $$SELECT public.expire_early_bird_subscriptions()$$
);
