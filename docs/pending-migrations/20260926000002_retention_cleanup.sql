-- PENDING — needs the owner's go-ahead before moving into supabase/migrations/.
-- First run permanently deletes existing guest analyses older than 7 days (183 rows on 2026-09-26).
--
-- Data retention, matching the privacy policy:
--  * Guest (no-account) resume checks: deleted 7 days after creation. They "expire" for the
--    visitor after 30 minutes, and claiming one copies it into the user's resume_analyses, so the
--    guest copy has no further use — but it holds the full resume text.
--  * Public-test rate-limit hashes: pruned after 60 days (b2b_prune_public_test_attempts, which
--    existed but was never scheduled).
SELECT cron.schedule(
  'delete-old-guest-analyses',
  '17 3 * * *',
  $$DELETE FROM public.guest_analyses WHERE created_at < now() - interval '7 days'$$
);

SELECT cron.schedule(
  'prune-public-test-attempts',
  '27 3 * * *',
  $$SELECT public.b2b_prune_public_test_attempts()$$
);
