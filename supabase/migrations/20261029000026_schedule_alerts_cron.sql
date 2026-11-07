-- R1.9: daily at 09:00 IST (03:30 UTC), email super admins the organisations that need attention
-- (20261029000025_b2b_org_alerts.sql). Same Vault secrets as the other B2B jobs; the email goes to the
-- B2B_ALERT_EMAIL function secret. Until the secrets exist the job does nothing.
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2b-alerts-digest',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url := u.decrypted_secret || '/functions/v1/b2b-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
    body := '{"action":"digest"}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM vault.decrypted_secrets u, vault.decrypted_secrets s
  WHERE u.name = 'b2b_project_url' AND s.name = 'b2b_cron_secret'
  $$
);
