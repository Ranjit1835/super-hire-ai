-- B40 (privacy): a proctoring session ends when the test or interview it watches ends.
-- Before this, a session ended only when the browser called `end` on unmount, so a page left open after
-- submit kept sending webcam/screen snapshots and events (and kept adding violations).
-- Ended sessions already refuse events (b2b_proctor_log_events), upload URLs (b2b-proctor) and storage
-- writes (evidence bucket policy). integrity_score stays NULL here: the browser's `end` call, or the review
-- page's provisional score, computes it from the events.

CREATE OR REPLACE FUNCTION public._b2b_proctor_end_for_context()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'attempts' THEN
    UPDATE public.proctoring_sessions SET status = 'ended', ended_at = COALESCE(ended_at, now())
      WHERE attempt_id = NEW.id AND status <> 'ended';
  ELSE
    UPDATE public.proctoring_sessions SET status = 'ended', ended_at = COALESCE(ended_at, now())
      WHERE interview_id = NEW.id AND status <> 'ended';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._b2b_proctor_end_for_context() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_attempt_end_proctoring ON public.attempts;
CREATE TRIGGER trg_attempt_end_proctoring
  AFTER UPDATE OF status ON public.attempts
  FOR EACH ROW
  WHEN (NEW.status IN ('submitted', 'expired', 'terminated') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._b2b_proctor_end_for_context();

DROP TRIGGER IF EXISTS trg_interview_end_proctoring ON public.b2b_interviews;
CREATE TRIGGER trg_interview_end_proctoring
  AFTER UPDATE OF status ON public.b2b_interviews
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'cancelled', 'abandoned') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._b2b_proctor_end_for_context();

-- Sessions already left open after their test or interview ended (seen in the 2026-11-03 local run).
UPDATE public.proctoring_sessions s SET status = 'ended', ended_at = COALESCE(s.ended_at, now())
  WHERE s.status <> 'ended' AND (
    EXISTS (SELECT 1 FROM public.attempts a WHERE a.id = s.attempt_id AND a.status IN ('submitted', 'expired', 'terminated'))
    OR EXISTS (SELECT 1 FROM public.b2b_interviews i WHERE i.id = s.interview_id AND i.status IN ('completed', 'cancelled', 'abandoned')));
