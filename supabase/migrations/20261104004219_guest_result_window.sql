-- A guest result now stays open for as long as it is kept (7 days, see retention_cleanup), which is
-- what the results page and the privacy policy already say. At 30 minutes, someone confirming their
-- email or coming back later lost their scan.
ALTER TABLE public.guest_analyses
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

UPDATE public.guest_analyses
SET expires_at = created_at + interval '7 days'
WHERE claimed_by IS NULL;
