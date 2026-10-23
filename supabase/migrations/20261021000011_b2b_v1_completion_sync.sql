-- B2B V1: sync a job-role candidate the moment their test or interview ends (added by the lead after merging
-- tracks C and E). Before this, _b2b_rc_sync ran only when the candidate, a recruiter or a report touched the row, so
-- the stage, completed_at and the credit charge waited for the next visit. Recruiter emails are still sent by the
-- b2b-company / b2b-candidate functions (b2b_claim_completion_notices) on their next call.

CREATE OR REPLACE FUNCTION public._b2b_rc_sync_on_step_end()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role UUID;
  v_candidate UUID;
  rc_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'attempts' THEN
    IF NEW.context_type <> 'job_role' OR NEW.status NOT IN ('submitted', 'expired', 'terminated') THEN RETURN NEW; END IF;
    v_role := NEW.context_id; v_candidate := NEW.candidate_id;
  ELSE
    IF NEW.kind <> 'job_role' OR NEW.status::text NOT IN ('completed', 'abandoned') THEN RETURN NEW; END IF;
    v_role := NEW.context_id; v_candidate := NEW.candidate_id;
  END IF;
  IF v_role IS NULL OR v_candidate IS NULL OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  FOR rc_id IN SELECT id FROM public.role_candidates WHERE job_role_id = v_role AND candidate_id = v_candidate LOOP
    PERFORM public._b2b_rc_sync(rc_id);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._b2b_rc_sync_on_step_end() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_b2b_rc_sync_attempt_end ON public.attempts;
CREATE TRIGGER trg_b2b_rc_sync_attempt_end
  AFTER UPDATE OF status ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public._b2b_rc_sync_on_step_end();

DROP TRIGGER IF EXISTS trg_b2b_rc_sync_interview_end ON public.b2b_interviews;
CREATE TRIGGER trg_b2b_rc_sync_interview_end
  AFTER UPDATE OF status ON public.b2b_interviews
  FOR EACH ROW EXECUTE FUNCTION public._b2b_rc_sync_on_step_end();
