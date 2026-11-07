# Plagiarism worker (R2.8)

Compares coding answers in a B2B drive with [Dolos](https://dolos.ugent.be) (MIT; tree-sitter tokens plus winnowed
k-gram fingerprints) and writes similar pairs back to Supabase. The database is the queue
(`supabase/migrations/20261029000031_b2b_similarity.sql`):

1. A drive's window ends. The `b2b-similarity` cron (every 10 min, migration 0032) queues one run per coding question and language. TPOs can also press **Check now**.
2. The cron calls `POST /run` on this service when anything is queued.
3. The worker claims a run (`b2b_similarity_claim`), runs Dolos with the question's starter code as the ignored template, and reports pairs at 30%+ similarity (`b2b_similarity_complete`). A failed run is retried, 3 tries in all, and a run stuck for 15 minutes is reclaimed.

The worker keeps no state, holds no student data after a request, and has no public data endpoints.

## Local tests

```sh
npm install          # tree-sitter needs a C++ toolchain; on Windows the Dolos test is skipped
npm test             # mapping, queue loop, auth; plus real Dolos where parsers built
DOLOS_REQUIRED=1 npm test   # CI and the Docker build: a missing parser fails
```

## Deploy (Cloud Run, asia-south1). The owner runs this; it's not automated.

```sh
gcloud run deploy plagiarism-worker --source services/plagiarism-worker --region asia-south1 \
  --allow-unauthenticated \
  --cpu 1 --memory 1Gi --timeout 900 --concurrency 1 --min-instances 0 --max-instances 2 \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest,WORKER_TOKEN=plagiarism-worker-token:latest \
  --set-env-vars SUPABASE_URL=https://<project-ref>.supabase.co
```

- `--allow-unauthenticated` is needed because pg_net can't mint Google ID tokens. `/run` checks `Authorization: Bearer WORKER_TOKEN` in constant time, and every other path returns 404.
- Keep the secrets in Secret Manager, never in env flags or the repo.
- Then add two Vault secrets in Supabase so the cron can reach the worker: `b2b_similarity_worker_url` (the Cloud Run URL) and `b2b_similarity_worker_token` (same value as `WORKER_TOKEN`).
- Cost: it scales to zero, one run takes seconds for a few hundred answers, and a drive is checked once after it closes.

Tuning: `DOLOS_KGRAM_LENGTH` and `DOLOS_KGRAMS_IN_WINDOW` override Dolos's defaults (23 / 17).
