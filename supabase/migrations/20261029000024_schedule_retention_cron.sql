-- R5.5: daily at 02:30 IST (21:00 UTC), ask b2b-retention to delete evidence and transcripts past their retention
-- (see 20261029000023_b2b_retention.sql). Same Vault secrets as the evaluation sweep
-- (20260924000004_schedule_evaluation_sweep_cron.sql); until both exist the job does nothing.
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2b-retention-sweep',
  '0 21 * * *',
  $$
  SELECT net.http_post(
    url := u.decrypted_secret || '/functions/v1/b2b-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
    body := '{"action":"sweep","batches":10}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM vault.decrypted_secrets u, vault.decrypted_secrets s
  WHERE u.name = 'b2b_project_url' AND s.name = 'b2b_cron_secret'
  $$
);
