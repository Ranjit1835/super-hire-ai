-- R5.5 retention: what the consent text promises (supabase/functions/_shared/company-logic.ts, src/b2b/proctor/consent.ts):
--  * screen and webcam snapshots: kept retention_days (org setting, default 90), "then deleted automatically";
--  * company interview transcripts: kept retention_days after the role closes (scores and reports stay).
-- The b2b-retention edge function (daily cron, 20261029000024_schedule_retention_cron.sql) deletes the files through
-- the Storage API (deleting storage.objects rows in SQL would leave the files behind), then calls these functions.
-- All service-role only.
-- Rollback: DROP FUNCTION public.b2b_retention_days(uuid), public.b2b_retention_due(integer),
-- public.b2b_retention_clear_evidence(bigint[]), public.b2b_retention_purge_transcripts().

CREATE OR REPLACE FUNCTION public.b2b_retention_days(_org_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT GREATEST(COALESCE(NULLIF(public.b2b_org_settings(_org_id)->>'retention_days', '')::int, 90), 1)
$$;

-- Evidence past its org's retention: { paths: [storage object names], event_ids: [proctoring_events.id] }.
-- Paths include snapshots never linked to an event (uploaded, but the event didn't arrive).
CREATE OR REPLACE FUNCTION public.b2b_retention_due(_limit INTEGER DEFAULT 500)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ids BIGINT[];
  v_paths TEXT[];
  v_objects TEXT[] := '{}';
  v_n INTEGER := LEAST(GREATEST(COALESCE(_limit, 500), 1), 1000);
BEGIN
  SELECT COALESCE(array_agg(id), '{}'), COALESCE(array_agg(evidence_path), '{}') INTO v_ids, v_paths FROM (
    SELECT e.id, e.evidence_path FROM public.proctoring_events e
    WHERE e.evidence_path IS NOT NULL
      AND e.started_at < now() - make_interval(days => public.b2b_retention_days(e.org_id))
    ORDER BY e.started_at LIMIT v_n
  ) x;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COALESCE(array_agg(name), '{}') FROM (
        SELECT o.name FROM storage.objects o
        WHERE o.bucket_id = 'b2b-evidence' AND (storage.foldername(o.name))[1] = 'org'
          AND (storage.foldername(o.name))[2] ~ '^[0-9a-f-]{36}$'
          AND o.created_at < now() - make_interval(days => public.b2b_retention_days(((storage.foldername(o.name))[2])::uuid))
        ORDER BY o.created_at LIMIT $1
      ) y
    $q$ INTO v_objects USING v_n;
  END IF;
  RETURN jsonb_build_object(
    'paths', to_jsonb(ARRAY(SELECT DISTINCT p FROM unnest(v_paths || v_objects) p)),
    'event_ids', to_jsonb(v_ids));
END;
$$;

-- After the files are gone: the events stay (they are the review record) without their evidence link.
CREATE OR REPLACE FUNCTION public.b2b_retention_clear_evidence(_event_ids BIGINT[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.proctoring_events
    SET evidence_path = NULL, meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('evidence_deleted_at', now())
    WHERE id = ANY (_event_ids) AND evidence_path IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Company interview transcripts once the role has been closed for the org's retention period. The interview row,
-- its evaluation (scores, report) and dimension scores stay. Closing time = the role's last update while closed
-- (a later edit only keeps the transcript longer).
CREATE OR REPLACE FUNCTION public.b2b_retention_purge_transcripts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM public.b2b_interview_turns t
    USING public.b2b_interviews i, public.job_roles jr
    WHERE t.interview_id = i.id AND i.kind = 'job_role' AND jr.id = i.context_id
      AND jr.status = 'closed' AND jr.updated_at < now() - make_interval(days => public.b2b_retention_days(jr.org_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM public.b2b_audit(NULL, 'retention.transcripts', 'b2b_interview_turns', NULL, jsonb_build_object('deleted', n)); END IF;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_retention_days(UUID), public.b2b_retention_due(INTEGER),
  public.b2b_retention_clear_evidence(BIGINT[]), public.b2b_retention_purge_transcripts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_retention_days(UUID), public.b2b_retention_due(INTEGER),
  public.b2b_retention_clear_evidence(BIGINT[]), public.b2b_retention_purge_transcripts() TO service_role;
