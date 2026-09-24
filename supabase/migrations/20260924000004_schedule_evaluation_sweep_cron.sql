-- Every 5 minutes, ask b2b-evaluate to score finished interviews that have no report yet
-- (provider outage, closed tab, public-test visitors who never return). Retry limits live in
-- b2b_interviews_needing_evaluation. A small batch keeps each run well inside the function time limit.
--
-- The project URL and cron secret are read from Supabase Vault, so none are stored in git:
--   select vault.create_secret('https://<ref>.supabase.co', 'b2b_project_url');
--   select vault.create_secret('<same value as the B2B_CRON_SECRET function secret>', 'b2b_cron_secret');
-- Until both exist the job does nothing.
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2b-evaluation-sweep',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := u.decrypted_secret || '/functions/v1/b2b-evaluate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
    body := '{"action":"sweep","limit":6}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM vault.decrypted_secrets u, vault.decrypted_secrets s
  WHERE u.name = 'b2b_project_url' AND s.name = 'b2b_cron_secret'
    AND EXISTS (
      SELECT 1 FROM public.b2b_interviews i
      JOIN public.organizations o ON o.id = i.org_id AND NOT o.is_demo
      LEFT JOIN public.b2b_evaluations e ON e.interview_id = i.id AND e.status = 'completed'
      WHERE i.status IN ('completed', 'abandoned') AND e.id IS NULL
        AND i.completed_at > now() - interval '7 days'
        AND EXISTS (SELECT 1 FROM public.b2b_interview_turns t WHERE t.interview_id = i.id AND t.role = 'student')
    )
  $$
);
