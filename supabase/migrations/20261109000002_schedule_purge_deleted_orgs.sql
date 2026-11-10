-- Daily purge of b2b_deleted_orgs rows past their legal retention (see 20261109000001_b2b_org_lifecycle.sql).
-- Kept apart from the b2b migration because pg_cron only exists on the real database, not in the PGlite tests.
SELECT cron.schedule('b2b-purge-deleted-orgs', '40 21 * * *', $$SELECT public.b2b_purge_deleted_orgs()$$);
