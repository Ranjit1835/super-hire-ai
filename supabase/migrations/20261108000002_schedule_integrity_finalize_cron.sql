-- B35: every 10 minutes, ask b2b-retention to score ended proctoring sessions that have no score
-- (see 20261108000001_b2b_integrity_finalize.sql). Same Vault secrets as the retention sweep; until both exist the
-- job does nothing.
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2b-integrity-finalize',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := u.decrypted_secret || '/functions/v1/b2b-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
    body := '{"action":"finalize_integrity"}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM vault.decrypted_secrets u, vault.decrypted_secrets s
  WHERE u.name = 'b2b_project_url' AND s.name = 'b2b_cron_secret'
  $$
);
