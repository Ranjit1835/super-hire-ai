-- R2.8: every 10 minutes, queue similarity checks for drives whose window ended (b2b_similarity_enqueue_due) and,
-- when anything is queued, wake the plagiarism worker (services/plagiarism-worker on Cloud Run).
-- Vault secrets, set when the worker is deployed; until both exist only the queueing runs:
--   b2b_similarity_worker_url    e.g. https://plagiarism-worker-xxxx.asia-south1.run.app
--   b2b_similarity_worker_token  shared secret, the worker's WORKER_TOKEN
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2b-similarity',
  '*/10 * * * *',
  $$
  SELECT public.b2b_similarity_enqueue_due();
  SELECT net.http_post(
    url := u.decrypted_secret || '/run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM vault.decrypted_secrets u, vault.decrypted_secrets s
  WHERE u.name = 'b2b_similarity_worker_url' AND s.name = 'b2b_similarity_worker_token'
    AND EXISTS (SELECT 1 FROM public.similarity_runs WHERE status = 'queued');
  $$
);
