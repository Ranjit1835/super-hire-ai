-- Mark B2B interviews abandoned 30 min after their deadline (also done lazily on start).
SELECT cron.schedule(
  'expire-stale-b2b-interviews',
  '*/15 * * * *',
  $$SELECT public.b2b_expire_stale_interviews()$$
);
