-- Track E — startup portal (proposed schema; applies after 20261021000008).
-- Conventions: SECURITY DEFINER + search_path = ''; service-role functions take _actor (or the candidate's
-- session user), re-check authorisation and set b2b.actor for the audit triggers; every role check COALESCEd;
-- REVOKE then explicit GRANT; internal helpers (prefixed _b2b_) are callable by nobody but the owner.
--
--   1. schema: job_roles.interview_config (read by track C), role_candidates session/progress columns,
--      role_candidate_decisions (decision history), guards on browser writes
--   2. staff: invite candidates (dedupe, credits), re-issue, pipeline, report, decide, share links, matches
--   3. candidate token flow: resolve, claim (link anonymous session), consent, system check, state + completion
--      (credit charge, idempotent per role candidate), completion notices
--   4. public share view

-- =============================================
-- 1. Schema
-- =============================================
-- AI interview configuration for the role. Track C reads it:
--   { enabled, duration_min (5–90), sections: [intro|technical|problem_solving|behavioral|code_walkthrough|
--     candidate_questions|close], difficulty: easy|medium|hard, code_walkthrough }
ALTER TABLE public.job_roles
  ADD COLUMN interview_config JSONB NOT NULL DEFAULT
    '{"enabled": true, "duration_min": 20, "sections": ["intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "close"], "difficulty": "medium", "code_walkthrough": true}'::jsonb
    CHECK (jsonb_typeof(interview_config) = 'object');

ALTER TABLE public.role_candidates
  ADD COLUMN session_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- anonymous session linked on first use
  ADD COLUMN linked_at TIMESTAMPTZ,
  ADD COLUMN consented_at TIMESTAMPTZ,
  ADD COLUMN system_checked_at TIMESTAMPTZ,
  ADD COLUMN notified_at TIMESTAMPTZ,       -- recruiters emailed about the completed session
  ADD COLUMN match_detail JSONB;            -- how the AI match score was computed (per skill, coverage, computed_at)
CREATE INDEX idx_role_candidates_session ON public.role_candidates(session_user_id) WHERE session_user_id IS NOT NULL;
CREATE INDEX idx_role_candidates_notify ON public.role_candidates(job_role_id) WHERE completed_at IS NOT NULL AND notified_at IS NULL;

CREATE TABLE public.role_candidate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_candidate_id UUID NOT NULL REFERENCES public.role_candidates(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('advance', 'hold', 'reject', 'hire')),
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rc_decisions ON public.role_candidate_decisions(role_candidate_id, created_at);
ALTER TABLE public.role_candidate_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read decisions" ON public.role_candidate_decisions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.role_candidates rc WHERE rc.id = role_candidate_id AND public.can_view_job_role(rc.job_role_id))
);
-- Written only by b2b_decide (service role).

-- Validate role edits made through RLS from the browser: interview config, skills matrix, hiring managers,
-- and that an open role has something for the candidate to do.
CREATE OR REPLACE FUNCTION public.job_roles_validate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c JSONB := NEW.interview_config;
  v_bad UUID;
BEGIN
  IF jsonb_typeof(c->'enabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(c->'duration_min') IS DISTINCT FROM 'number'
     OR (c->>'duration_min')::numeric NOT BETWEEN 5 AND 90
     OR COALESCE(c->>'difficulty', '') NOT IN ('easy', 'medium', 'hard')
     OR jsonb_typeof(c->'code_walkthrough') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(c->'sections') IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'sections') s
                WHERE s NOT IN ('intro', 'technical', 'problem_solving', 'behavioral', 'code_walkthrough', 'candidate_questions', 'close')) THEN
    RAISE EXCEPTION 'INVALID_INTERVIEW_CONFIG' USING ERRCODE = 'check_violation';
  END IF;
  NEW.code_walkthrough := (c->>'code_walkthrough')::boolean;

  IF NEW.skills_matrix <> '{}'::jsonb THEN
    IF jsonb_typeof(NEW.skills_matrix->'must_have') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.skills_matrix->'must_have') = 0
       OR jsonb_typeof(COALESCE(NEW.skills_matrix->'nice_to_have', '[]'::jsonb)) <> 'array'
       OR COALESCE(NEW.skills_matrix->>'seniority', '') NOT IN ('intern', 'junior', 'mid', 'senior', 'lead') THEN
      RAISE EXCEPTION 'INVALID_SKILLS_MATRIX' USING ERRCODE = 'check_violation';
    END IF;
    NEW.seniority := NEW.skills_matrix->>'seniority';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.hiring_manager_ids IS DISTINCT FROM OLD.hiring_manager_ids THEN
    SELECT x INTO v_bad FROM unnest(NEW.hiring_manager_ids) x
      WHERE NOT EXISTS (SELECT 1 FROM public.org_memberships m
                        WHERE m.org_id = NEW.org_id AND m.user_id = x AND m.role = 'hiring_manager')
      LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'NOT_A_HIRING_MANAGER: % is not a hiring manager of this company', v_bad USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Browser edits only (service-role / seed inserts are trusted).
  IF current_user = 'authenticated' AND NEW.status = 'open' AND (NEW.skills_matrix = '{}'::jsonb
     OR (NEW.assessment_id IS NULL AND NOT (c->>'enabled')::boolean)) THEN
    RAISE EXCEPTION 'ROLE_INCOMPLETE: an open role needs a skills matrix and a coding test or an AI interview'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_roles_validate BEFORE INSERT OR UPDATE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.job_roles_validate();

-- From the browser, staff may only move the pipeline stage directly; tokens, links, scores, credits and
-- decisions are written by the service-role functions below.
CREATE OR REPLACE FUNCTION public.role_candidates_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated' AND (to_jsonb(NEW) - 'stage') IS DISTINCT FROM (to_jsonb(OLD) - 'stage') THEN
    RAISE EXCEPTION 'role_candidates: only the stage can be changed directly' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER role_candidates_guard BEFORE UPDATE ON public.role_candidates
  FOR EACH ROW EXECUTE FUNCTION public.role_candidates_guard();

-- candidates.user_id is set only by the token flow (service role).
CREATE OR REPLACE FUNCTION public.candidates_user_id_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.user_id IS DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD.user_id ELSE NULL END) THEN
    RAISE EXCEPTION 'candidates.user_id is set by the invite link only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER candidates_user_id_guard BEFORE INSERT OR UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.candidates_user_id_guard();

-- Share links: from the browser, only revoking (once) is allowed; no extending, no un-revoking.
CREATE OR REPLACE FUNCTION public.share_links_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated' AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')) THEN
    RAISE EXCEPTION 'share links can only be revoked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER share_links_guard BEFORE UPDATE ON public.share_links
  FOR EACH ROW EXECUTE FUNCTION public.share_links_guard();

-- =============================================
-- 2. Helpers
-- =============================================
-- Company admin or recruiter (or super admin).
CREATE OR REPLACE FUNCTION public.actor_is_company_editor(_actor UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND (COALESCE(public.actor_is_super_admin(_actor), false)
      OR COALESCE(public.actor_org_role(_actor, _org_id) IN ('org_admin', 'recruiter'), false))
$$;

-- 'editor' (admin / recruiter / super admin), 'viewer' (hiring manager assigned to the role) or NULL.
CREATE OR REPLACE FUNCTION public._b2b_role_access(_actor UUID, _job_role_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN public.actor_is_company_editor(_actor, r.org_id) THEN 'editor'
    WHEN COALESCE(public.b2b_actor_can_view_context(_actor, r.org_id, 'job_role', r.id), false) THEN 'viewer'
  END
  FROM public.job_roles r WHERE r.id = _job_role_id
$$;

-- Credits per completed candidate session (org setting candidate_session_credits, default 1).
CREATE OR REPLACE FUNCTION public._b2b_candidate_cost(_org_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT GREATEST(COALESCE(NULLIF(public.b2b_org_settings(_org_id)->>'candidate_session_credits', '')::numeric, 1), 0.01)
$$;

-- =============================================
-- 3. Staff: invites
-- =============================================
-- _candidates: [{ email, full_name, phone?, token_hash }] (validated by the edge function; re-checked here).
-- Dedupe: within the list, and per role (a candidate is invited to a role once; resend re-issues the link).
-- Blocked when the balance can't cover one session per new invite.
-- Returns { ok, invited: [{ role_candidate_id, email, full_name, token_index }], skipped: [{ email, reason }] }.
CREATE OR REPLACE FUNCTION public.b2b_invite_candidates(_actor UUID, _job_role_id UUID, _candidates JSONB, _source TEXT DEFAULT 'invite')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  jr public.job_roles;
  o public.organizations;
  c JSONB;
  v_idx BIGINT;
  v_email TEXT;
  v_name TEXT;
  v_seen TEXT[] := '{}';
  v_ok JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
  v_invited JSONB := '[]'::jsonb;
  v_cost NUMERIC;
  v_cand UUID;
  v_rc UUID;
BEGIN
  SELECT * INTO jr FROM public.job_roles WHERE id = _job_role_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT public.actor_is_company_editor(_actor, jr.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.organizations WHERE id = jr.org_id;
  IF o.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_SUSPENDED'); END IF;
  IF jr.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ROLE_NOT_OPEN'); END IF;
  IF jsonb_typeof(_candidates) <> 'array' OR jsonb_array_length(_candidates) > 500 THEN
    RAISE EXCEPTION 'INVALID_CANDIDATES' USING ERRCODE = 'check_violation';
  END IF;
  IF _source NOT IN ('invite', 'csv') THEN _source := 'invite'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('role_invites:' || jr.id::text, 0));

  FOR c, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(_candidates) WITH ORDINALITY LOOP
    v_email := lower(btrim(COALESCE(c->>'email', '')));
    v_name := btrim(COALESCE(c->>'full_name', ''));
    IF COALESCE(c->>'token_hash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'INVALID_TOKEN_HASH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'invalid_email');
    ELSIF v_name = '' OR length(v_name) > 200 THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'missing_name');
    ELSIF v_email = ANY (v_seen) THEN
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'duplicate_in_list');
    ELSIF EXISTS (SELECT 1 FROM public.role_candidates rc JOIN public.candidates ca ON ca.id = rc.candidate_id
                  WHERE rc.job_role_id = jr.id AND ca.email = v_email) THEN
      v_seen := v_seen || v_email;
      v_skipped := v_skipped || jsonb_build_object('email', v_email, 'reason', 'already_invited');
    ELSE
      v_seen := v_seen || v_email;
      v_ok := v_ok || jsonb_build_object('email', v_email, 'full_name', v_name,
        'phone', NULLIF(btrim(COALESCE(c->>'phone', '')), ''), 'token_hash', c->>'token_hash', 'idx', v_idx);
    END IF;
  END LOOP;

  v_cost := public._b2b_candidate_cost(jr.org_id);
  IF jsonb_array_length(v_ok) > 0 AND o.credits_balance < v_cost * jsonb_array_length(v_ok) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_CREDITS', 'balance', o.credits_balance,
                              'needed', v_cost * jsonb_array_length(v_ok));
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(v_ok) LOOP
    INSERT INTO public.candidates (org_id, email, full_name, phone, source, created_by)
      VALUES (jr.org_id, c->>'email', c->>'full_name', left(c->>'phone', 30), _source, _actor)
    ON CONFLICT (org_id, email) DO UPDATE SET phone = COALESCE(public.candidates.phone, EXCLUDED.phone)
    RETURNING id INTO v_cand;
    INSERT INTO public.role_candidates (org_id, job_role_id, candidate_id, invite_token_hash, invite_expires_at)
      VALUES (jr.org_id, jr.id, v_cand, c->>'token_hash', now() + make_interval(days => jr.invite_expiry_days))
    RETURNING id INTO v_rc;
    v_invited := v_invited || jsonb_build_object('role_candidate_id', v_rc, 'email', c->>'email',
      'full_name', (SELECT full_name FROM public.candidates WHERE id = v_cand), 'token_index', (c->>'idx')::integer);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'invited', v_invited, 'skipped', v_skipped,
    'role_title', jr.title, 'org_name', o.name, 'expiry_days', jr.invite_expiry_days);
END;
$$;

-- Email outcome for candidate invites (service role).
CREATE OR REPLACE FUNCTION public.b2b_mark_candidate_email(_rc_ids UUID[], _error TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.role_candidates
     SET email_sent_at = CASE WHEN _error IS NULL THEN now() ELSE email_sent_at END,
         email_error = left(_error, 300)
   WHERE id = ANY (_rc_ids)
$$;

-- New link (old one stops working), fresh expiry, and the session link is released so the candidate can
-- continue from another browser; their work moves to the new session on the next claim.
CREATE OR REPLACE FUNCTION public.b2b_reissue_candidate_invite(_actor UUID, _rc_id UUID, _token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; jr public.job_roles; ca public.candidates;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE id = _rc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT public.actor_is_company_editor(_actor, rc.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_TOKEN_HASH' USING ERRCODE = 'check_violation'; END IF;
  IF rc.stage = 'withdrawn' THEN RETURN jsonb_build_object('ok', false, 'reason', 'WITHDRAWN'); END IF;
  SELECT * INTO jr FROM public.job_roles WHERE id = rc.job_role_id;
  IF jr.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ROLE_CLOSED'); END IF;
  SELECT * INTO ca FROM public.candidates WHERE id = rc.candidate_id;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.role_candidates SET invite_token_hash = _token_hash,
    invite_expires_at = now() + make_interval(days => jr.invite_expiry_days),
    session_user_id = NULL, linked_at = NULL, email_sent_at = NULL, email_error = NULL
  WHERE id = rc.id;
  PERFORM public.b2b_audit(rc.org_id, 'role_candidates.reissue', 'role_candidates', rc.id::text, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'email', ca.email, 'full_name', ca.full_name, 'role_title', jr.title,
    'org_name', (SELECT name FROM public.organizations WHERE id = rc.org_id), 'expiry_days', jr.invite_expiry_days);
END;
$$;

-- =============================================
-- 4. Progress, completion, credits
-- =============================================
-- Step statuses for a role candidate, linking the attempt / interview, marking completion (charging credits
-- once, idempotent per role candidate) and moving invited → in_progress. Returns the state plus just_completed.
CREATE OR REPLACE FUNCTION public._b2b_rc_sync(_rc_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rc public.role_candidates;
  jr public.job_roles;
  a public.attempts;
  iv public.b2b_interviews;
  v_coding TEXT;
  v_interview TEXT;
  v_all_done BOOLEAN;
  v_just BOOLEAN := false;
  v_charge JSONB;
  v_interview_on BOOLEAN;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE id = _rc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO jr FROM public.job_roles WHERE id = rc.job_role_id;
  v_interview_on := COALESCE((jr.interview_config->>'enabled')::boolean, false);

  SELECT * INTO a FROM public.attempts
    WHERE id = rc.attempt_id
       OR (context_type = 'job_role' AND context_id = jr.id AND candidate_id = rc.candidate_id)
    ORDER BY (id = rc.attempt_id) DESC NULLS LAST, created_at DESC LIMIT 1;
  SELECT * INTO iv FROM public.b2b_interviews
    WHERE id = rc.interview_id
       OR (kind = 'job_role' AND context_id = jr.id
           AND (candidate_id = rc.candidate_id OR (rc.session_user_id IS NOT NULL AND user_id = rc.session_user_id)))
    ORDER BY (id = rc.interview_id) DESC NULLS LAST, started_at DESC LIMIT 1;

  v_coding := CASE WHEN jr.assessment_id IS NULL AND a.id IS NULL THEN NULL
                   WHEN a.id IS NULL THEN 'todo'
                   WHEN a.status IN ('not_started', 'in_progress') THEN 'in_progress'
                   ELSE 'done' END;
  v_interview := CASE WHEN NOT v_interview_on AND iv.id IS NULL THEN NULL
                      WHEN iv.id IS NULL OR iv.status::text = 'cancelled' THEN 'todo'
                      WHEN iv.status::text = 'in_progress' THEN 'in_progress'
                      ELSE 'done' END;
  v_all_done := rc.consented_at IS NOT NULL AND (v_coding IS NOT NULL OR v_interview IS NOT NULL)
                AND COALESCE(v_coding, 'done') = 'done' AND COALESCE(v_interview, 'done') = 'done';

  UPDATE public.role_candidates SET
    attempt_id = COALESCE(a.id, attempt_id),
    interview_id = COALESCE(iv.id, interview_id),
    started_at = CASE WHEN started_at IS NULL AND (a.id IS NOT NULL OR iv.id IS NOT NULL) THEN now() ELSE started_at END,
    stage = CASE WHEN stage = 'invited' AND (a.id IS NOT NULL OR iv.id IS NOT NULL OR v_all_done) THEN 'in_progress' ELSE stage END
  WHERE id = rc.id AND (attempt_id IS DISTINCT FROM COALESCE(a.id, attempt_id)
                        OR interview_id IS DISTINCT FROM COALESCE(iv.id, interview_id)
                        OR (started_at IS NULL AND (a.id IS NOT NULL OR iv.id IS NOT NULL))
                        OR (stage = 'invited' AND (a.id IS NOT NULL OR iv.id IS NOT NULL OR v_all_done)));

  IF v_all_done AND rc.completed_at IS NULL THEN
    UPDATE public.role_candidates SET completed_at = now(),
      stage = CASE WHEN stage IN ('invited', 'in_progress') THEN 'completed' ELSE stage END
    WHERE id = rc.id;
    v_just := true;
  END IF;
  -- Charge once per completed session (retried on later syncs if the balance was short).
  IF v_all_done AND NOT rc.credits_charged THEN
    v_charge := public.b2b_consume_credits(rc.org_id, public._b2b_candidate_cost(rc.org_id), 'candidate_session',
                                           'role_candidate', rc.id::text, rc.session_user_id);
    IF COALESCE((v_charge->>'ok')::boolean, false) THEN
      UPDATE public.role_candidates SET credits_charged = true WHERE id = rc.id;
    END IF;
  END IF;

  SELECT * INTO rc FROM public.role_candidates WHERE id = rc.id;
  RETURN jsonb_build_object(
    'role_candidate_id', rc.id, 'job_role_id', jr.id, 'stage', rc.stage,
    'attempt_id', rc.attempt_id, 'interview_id', rc.interview_id,
    'steps', jsonb_build_object(
      'consent', CASE WHEN rc.consented_at IS NOT NULL THEN 'done' ELSE 'todo' END,
      'system_check', CASE WHEN rc.system_checked_at IS NOT NULL THEN 'done' ELSE 'todo' END,
      'coding', v_coding, 'interview', v_interview,
      'done', CASE WHEN rc.completed_at IS NOT NULL THEN 'done' ELSE 'todo' END),
    'completed', rc.completed_at IS NOT NULL, 'just_completed', v_just, 'credits_charged', rc.credits_charged);
END;
$$;

-- Completed sessions whose recruiters haven't been emailed yet; claims them (sets notified_at) and returns
-- what the email needs. Recipients: the org's recruiters plus the role's creator; org admins if no recruiter.
CREATE OR REPLACE FUNCTION public.b2b_claim_completion_notices(_job_role_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
  WITH claimed AS (
    UPDATE public.role_candidates SET notified_at = now()
    WHERE job_role_id = _job_role_id AND completed_at IS NOT NULL AND notified_at IS NULL
    RETURNING id, org_id, job_role_id, candidate_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'role_candidate_id', c.id, 'org_id', c.org_id, 'job_role_id', c.job_role_id, 'role_title', jr.title,
    'candidate_name', ca.full_name,
    'recipients', COALESCE((
      SELECT jsonb_agg(DISTINCT m.email) FROM public.org_memberships m
      WHERE m.org_id = c.org_id AND m.email IS NOT NULL
        AND (m.role = 'recruiter' OR m.user_id = jr.created_by
             OR (m.role = 'org_admin' AND NOT EXISTS (SELECT 1 FROM public.org_memberships r
                                                      WHERE r.org_id = c.org_id AND r.role = 'recruiter')))), '[]'::jsonb)
  )), '[]'::jsonb) INTO v
  FROM claimed c JOIN public.job_roles jr ON jr.id = c.job_role_id JOIN public.candidates ca ON ca.id = c.candidate_id;
  RETURN v;
END;
$$;

-- =============================================
-- 5. Candidate token flow (no password; anonymous Supabase session)
-- =============================================
-- What a link is for. status: valid | expired | revoked | closed | invalid. Full email for the edge
-- function, which masks it before answering.
CREATE OR REPLACE FUNCTION public.b2b_resolve_candidate_token(_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; jr public.job_roles; o public.organizations; ca public.candidates; v_status TEXT;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE invite_token_hash = _token_hash;
  IF NOT FOUND OR _token_hash IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO jr FROM public.job_roles WHERE id = rc.job_role_id;
  SELECT * INTO o FROM public.organizations WHERE id = rc.org_id;
  SELECT * INTO ca FROM public.candidates WHERE id = rc.candidate_id;
  v_status := CASE
    WHEN rc.completed_at IS NOT NULL THEN 'valid'
    WHEN rc.stage IN ('withdrawn', 'rejected') OR o.status <> 'active' THEN 'revoked'
    WHEN jr.status <> 'open' THEN 'closed'
    WHEN rc.invite_expires_at IS NOT NULL AND rc.invite_expires_at <= now() AND rc.started_at IS NULL THEN 'expired'
    ELSE 'valid' END;
  RETURN jsonb_build_object('status', v_status, 'role_candidate_id', rc.id,
    'company', jsonb_build_object('name', o.name, 'logo_url', o.logo_url),
    'role', jsonb_build_object('title', jr.title),
    'candidate', jsonb_build_object('full_name', ca.full_name, 'email', ca.email),
    'has_coding', jr.assessment_id IS NOT NULL,
    'has_interview', COALESCE((jr.interview_config->>'enabled')::boolean, false),
    'policy', jr.proctoring_policy, 'linked', rc.session_user_id IS NOT NULL, 'completed', rc.completed_at IS NOT NULL);
END;
$$;

-- The calling session's role candidate for a token; refuses other sessions. Internal.
CREATE OR REPLACE FUNCTION public._b2b_token_rc(_token_hash TEXT, _user_id UUID)
RETURNS public.role_candidates LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE invite_token_hash = _token_hash;
  IF NOT FOUND OR _user_id IS NULL OR rc.session_user_id IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: this link is open in another browser' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN rc;
END;
$$;

-- First use links the anonymous session to the candidate; afterwards only that session may use the link
-- (until the recruiter re-issues it). Re-issued links move the candidate's work for this role to the new session.
CREATE OR REPLACE FUNCTION public.b2b_claim_candidate_token(_token_hash TEXT, _user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB := public.b2b_resolve_candidate_token(_token_hash);
  rc public.role_candidates;
  v_prev UUID;
BEGIN
  IF r->>'status' <> 'valid' THEN RETURN jsonb_build_object('ok', false, 'reason', upper(r->>'status')); END IF;
  IF NOT COALESCE((SELECT is_anonymous FROM auth.users WHERE id = _user_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ANONYMOUS');
  END IF;
  SELECT * INTO rc FROM public.role_candidates WHERE invite_token_hash = _token_hash FOR UPDATE;
  IF rc.session_user_id IS NOT NULL AND rc.session_user_id <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_DEVICE');
  END IF;
  PERFORM set_config('b2b.actor', _user_id::text, true);
  IF rc.session_user_id IS NULL THEN
    SELECT user_id INTO v_prev FROM public.candidates WHERE id = rc.candidate_id;
    UPDATE public.role_candidates SET session_user_id = _user_id, linked_at = now() WHERE id = rc.id;
    UPDATE public.candidates SET user_id = _user_id WHERE id = rc.candidate_id;
    -- Re-issued link: the work done so far for this role moves to the new session.
    UPDATE public.attempts SET subject_user_id = _user_id, active_session_id = NULL
      WHERE context_type = 'job_role' AND context_id = rc.job_role_id AND candidate_id = rc.candidate_id
        AND subject_user_id <> _user_id;
    UPDATE public.b2b_interviews SET user_id = _user_id
      WHERE kind = 'job_role' AND context_id = rc.job_role_id AND user_id <> _user_id
        AND (candidate_id = rc.candidate_id OR id = rc.interview_id OR (v_prev IS NOT NULL AND user_id = v_prev));
    UPDATE public.proctoring_sessions SET subject_user_id = _user_id
      WHERE context_type = 'job_role' AND context_id = rc.job_role_id AND subject_user_id <> _user_id
        AND (attempt_id IN (SELECT id FROM public.attempts WHERE context_type = 'job_role' AND context_id = rc.job_role_id
                                                              AND candidate_id = rc.candidate_id)
             OR interview_id IN (SELECT id FROM public.b2b_interviews WHERE kind = 'job_role' AND context_id = rc.job_role_id
                                                                         AND user_id = _user_id));
  END IF;
  RETURN jsonb_build_object('ok', true) || public._b2b_rc_sync(rc.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_candidate_state(_token_hash TEXT, _user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates;
BEGIN
  rc := public._b2b_token_rc(_token_hash, _user_id);
  PERFORM set_config('b2b.actor', _user_id::text, true);
  RETURN jsonb_build_object('ok', true) || public._b2b_rc_sync(rc.id);
END;
$$;

-- Purposes the candidate must agree to for this role (itemised; proctoring ones only when proctored).
CREATE OR REPLACE FUNCTION public._b2b_required_purposes(_job_role_id UUID)
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY['account', 'assessment']
    || CASE WHEN COALESCE((r.interview_config->>'enabled')::boolean, false) THEN ARRAY['interview_audio', 'recording'] ELSE '{}'::text[] END
    || CASE WHEN r.proctoring_policy <> 'off' THEN ARRAY['proctoring_screen', 'proctoring_camera', 'proctoring_audio'] ELSE '{}'::text[] END
  FROM public.job_roles r WHERE r.id = _job_role_id
$$;

-- _consents: [{ purpose, version, text }] — the exact text shown. Every required purpose must be present.
CREATE OR REPLACE FUNCTION public.b2b_candidate_consent(_token_hash TEXT, _user_id UUID, _consents JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; c JSONB; v_missing TEXT[];
BEGIN
  rc := public._b2b_token_rc(_token_hash, _user_id);
  IF jsonb_typeof(_consents) <> 'array' THEN RAISE EXCEPTION 'INVALID_CONSENTS' USING ERRCODE = 'check_violation'; END IF;
  SELECT array_agg(p ORDER BY ord) INTO v_missing
    FROM unnest(public._b2b_required_purposes(rc.job_role_id)) WITH ORDINALITY AS x(p, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_consents) x WHERE x->>'purpose' = p);
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CONSENT_REQUIRED', 'missing', to_jsonb(v_missing));
  END IF;
  PERFORM set_config('b2b.actor', _user_id::text, true);
  FOR c IN SELECT value FROM jsonb_array_elements(_consents) LOOP
    PERFORM public.b2b_record_consent(rc.org_id, _user_id, c->>'purpose', c->>'version', c->>'text');
  END LOOP;
  UPDATE public.role_candidates SET consented_at = COALESCE(consented_at, now()) WHERE id = rc.id;
  RETURN jsonb_build_object('ok', true) || public._b2b_rc_sync(rc.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_candidate_system_checked(_token_hash TEXT, _user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates;
BEGIN
  rc := public._b2b_token_rc(_token_hash, _user_id);
  PERFORM set_config('b2b.actor', _user_id::text, true);
  UPDATE public.role_candidates SET system_checked_at = COALESCE(system_checked_at, now()) WHERE id = rc.id;
  RETURN jsonb_build_object('ok', true) || public._b2b_rc_sync(rc.id);
END;
$$;

-- =============================================
-- 6. Staff: pipeline, report, decisions, matches
-- =============================================
-- Raw report data (the edge function shapes it and computes the match score). _staff = false drops contact
-- details, comments, decisions and proctoring session ids (share view).
CREATE OR REPLACE FUNCTION public._b2b_report_json(_rc_id UUID, _staff BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rc public.role_candidates; jr public.job_roles; ca public.candidates; a public.attempts; iv public.b2b_interviews;
  v_attempt JSONB; v_interview JSONB;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE id = _rc_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO jr FROM public.job_roles WHERE id = rc.job_role_id;
  SELECT * INTO ca FROM public.candidates WHERE id = rc.candidate_id;
  SELECT * INTO a FROM public.attempts WHERE id = rc.attempt_id;
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = rc.interview_id;

  IF a.id IS NOT NULL THEN
    v_attempt := jsonb_build_object('id', a.id, 'status', a.status, 'score', a.score, 'max_score', a.max_score,
      'submitted_at', a.submitted_at, 'end_reason', a.end_reason, 'grading', a.grading_status,
      'questions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('question_id', q.id, 'title', q.title, 'type', q.type,
          'language', COALESCE(s.language, aa.language), 'code', COALESCE(s.code, aa.code),
          'passed', s.passed, 'total', s.total, 'score', s.score, 'max_score', COALESCE(s.max_score, q.points),
          'status', s.status) ORDER BY e.ord)
        FROM jsonb_array_elements(a.question_set) WITH ORDINALITY AS e(v, ord)
        JOIN public.questions q ON q.id = (e.v->>'question_id')::uuid
        LEFT JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = q.id
        LEFT JOIN LATERAL (SELECT * FROM public.submissions x
                           WHERE x.attempt_id = a.id AND x.question_id = q.id AND x.kind IN ('submit', 'final')
                           ORDER BY (x.kind = 'final') DESC, x.created_at DESC LIMIT 1) s ON true
        WHERE q.type = 'coding'), '[]'::jsonb));
  END IF;

  IF iv.id IS NOT NULL THEN
    v_interview := jsonb_build_object('id', iv.id, 'status', iv.status::text, 'started_at', iv.started_at,
      'completed_at', iv.completed_at,
      'transcript', COALESCE((SELECT jsonb_agg(jsonb_build_object('turn', t.turn_index, 'role', t.role, 'content', t.content)
                                               ORDER BY t.turn_index, CASE t.role WHEN 'interviewer' THEN 0 ELSE 1 END)
                              FROM public.b2b_interview_turns t WHERE t.interview_id = iv.id), '[]'::jsonb),
      'evaluation', (SELECT jsonb_build_object('status', e.status, 'overall_score', e.overall_score,
                                               'readiness_level', e.readiness_level, 'result', e.result)
                     FROM public.b2b_evaluations e WHERE e.interview_id = iv.id
                     ORDER BY (e.status = 'completed') DESC, e.created_at DESC LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'role_candidate_id', rc.id, 'stage', rc.stage, 'decision', rc.decision, 'invited_at', rc.invited_at,
    'started_at', rc.started_at, 'completed_at', rc.completed_at, 'credits_charged', rc.credits_charged,
    'match_score', rc.match_score, 'recommendation', rc.recommendation,
    'candidate', jsonb_build_object('full_name', ca.full_name,
                                    'email', CASE WHEN _staff THEN ca.email END, 'phone', CASE WHEN _staff THEN ca.phone END),
    'role', jsonb_build_object('id', jr.id, 'title', jr.title, 'skills_matrix', jr.skills_matrix,
                               'org_name', (SELECT name FROM public.organizations WHERE id = jr.org_id),
                               'has_coding', jr.assessment_id IS NOT NULL,
                               'has_interview', COALESCE((jr.interview_config->>'enabled')::boolean, false)),
    'attempt', v_attempt,
    'interview', v_interview,
    'dimension_scores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('source_type', d.source_type, 'dimension', d.dimension, 'topic', d.topic, 'score', d.score))
      FROM public.dimension_scores d
      WHERE d.org_id = rc.org_id AND d.context_type = 'job_role' AND d.context_id = jr.id
        AND (d.candidate_id = rc.candidate_id OR d.source_id = rc.attempt_id OR d.source_id = rc.interview_id)), '[]'::jsonb),
    'integrity', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'session_id', CASE WHEN _staff THEN s.id END,
        'kind', CASE WHEN s.attempt_id IS NOT NULL THEN 'coding' ELSE 'interview' END,
        'policy', s.policy, 'status', s.status, 'score', s.integrity_score, 'band', s.integrity_band,
        'violations', s.violations,
        'flags', (SELECT count(*) FROM public.proctoring_events ev WHERE ev.session_id = s.id AND ev.severity IN ('medium', 'high')),
        'review', (SELECT r.decision FROM public.integrity_reviews r WHERE r.session_id = s.id ORDER BY r.created_at DESC LIMIT 1))
        ORDER BY s.started_at)
      FROM public.proctoring_sessions s
      WHERE (rc.attempt_id IS NOT NULL AND s.attempt_id = rc.attempt_id)
         OR (rc.interview_id IS NOT NULL AND s.interview_id = rc.interview_id)), '[]'::jsonb),
    'comments', CASE WHEN _staff THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', cm.id, 'body', cm.body, 'created_at', cm.created_at, 'author_id', cm.author_id,
                                          'author', COALESCE(m.full_name, m.email, 'Team member')) ORDER BY cm.created_at)
      FROM public.role_candidate_comments cm
      LEFT JOIN public.org_memberships m ON m.org_id = cm.org_id AND m.user_id = cm.author_id
      WHERE cm.role_candidate_id = rc.id), '[]'::jsonb) ELSE '[]'::jsonb END,
    'decisions', CASE WHEN _staff THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('decision', d.decision, 'note', d.note, 'created_at', d.created_at,
                                          'by', COALESCE(m.full_name, m.email, 'Team member')) ORDER BY d.created_at)
      FROM public.role_candidate_decisions d
      LEFT JOIN public.org_memberships m ON m.org_id = d.org_id AND m.user_id = d.decided_by
      WHERE d.role_candidate_id = rc.id), '[]'::jsonb) ELSE '[]'::jsonb END);
END;
$$;

-- Staff report: refreshes progress first. { ok, access: editor|viewer, report }.
CREATE OR REPLACE FUNCTION public.b2b_candidate_report(_actor UUID, _rc_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; v_access TEXT;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE id = _rc_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  v_access := public._b2b_role_access(_actor, rc.job_role_id);
  IF v_access IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  PERFORM public._b2b_rc_sync(rc.id);
  RETURN jsonb_build_object('ok', true, 'access', v_access, 'report', public._b2b_report_json(rc.id, true));
END;
$$;

-- Store AI match scores computed by the edge function. _items: [{ role_candidate_id, score, recommendation, detail }].
CREATE OR REPLACE FUNCTION public.b2b_store_matches(_actor UUID, _items JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE it JSONB; n INTEGER := 0; v_role UUID;
BEGIN
  FOR it IN SELECT value FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    SELECT job_role_id INTO v_role FROM public.role_candidates WHERE id = (it->>'role_candidate_id')::uuid;
    IF v_role IS NULL OR public._b2b_role_access(_actor, v_role) IS NULL THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.role_candidates SET
      match_score = CASE WHEN it->>'score' IS NULL THEN NULL ELSE LEAST(100, GREATEST(0, (it->>'score')::numeric)) END,
      recommendation = CASE WHEN it->>'recommendation' IN ('strong', 'good', 'borderline', 'not_yet') THEN it->>'recommendation' END,
      match_detail = COALESCE(it->'detail', '{}'::jsonb) || jsonb_build_object('computed_at', now())
    WHERE id = (it->>'role_candidate_id')::uuid;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Report data for up to 50 rows of a role whose match score is missing or older than their latest result.
CREATE OR REPLACE FUNCTION public.b2b_match_inputs(_actor UUID, _job_role_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public._b2b_role_access(_actor, _job_role_id) IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public._b2b_report_json(x.id, false))
    FROM (
      SELECT rc.id FROM public.role_candidates rc
      LEFT JOIN public.attempts a ON a.id = rc.attempt_id
      LEFT JOIN LATERAL (SELECT max(e.completed_at) AS at FROM public.b2b_evaluations e
                         WHERE e.interview_id = rc.interview_id AND e.status = 'completed') ev ON true
      WHERE rc.job_role_id = _job_role_id
        AND ((a.id IS NOT NULL AND a.status NOT IN ('not_started', 'in_progress')) OR ev.at IS NOT NULL)
        AND (rc.match_detail IS NULL
             OR (rc.match_detail->>'computed_at')::timestamptz < GREATEST(a.updated_at, ev.at))
      ORDER BY rc.completed_at DESC NULLS LAST LIMIT 50) x), '[]'::jsonb);
END;
$$;

-- One row per role candidate with the numbers the pipeline shows (latest evaluation, lowest integrity score).
CREATE OR REPLACE FUNCTION public._b2b_pipeline_base(_job_role_id UUID)
RETURNS TABLE (
  id UUID, full_name TEXT, email TEXT, phone TEXT, stage TEXT, decision TEXT, match_score NUMERIC, recommendation TEXT,
  invited_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, invite_expires_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ, email_error TEXT, attempt_status TEXT, coding NUMERIC, interview NUMERIC,
  integrity NUMERIC, integrity_band TEXT, credits_charged BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT rc.id, ca.full_name, ca.email, ca.phone, rc.stage, rc.decision, rc.match_score, rc.recommendation,
         rc.invited_at, rc.started_at, rc.completed_at, rc.invite_expires_at, rc.email_sent_at, rc.email_error,
         a.status, CASE WHEN a.max_score > 0 THEN round(a.score / a.max_score * 100, 1) END,
         ev.overall_score * 10, ps.integrity_score, ps.integrity_band, rc.credits_charged
  FROM public.role_candidates rc
  JOIN public.candidates ca ON ca.id = rc.candidate_id
  LEFT JOIN public.attempts a ON a.id = rc.attempt_id
  LEFT JOIN LATERAL (SELECT e.overall_score FROM public.b2b_evaluations e
                     WHERE e.interview_id = rc.interview_id AND e.status = 'completed'
                     ORDER BY e.completed_at DESC LIMIT 1) ev ON true
  LEFT JOIN LATERAL (SELECT s.integrity_score, s.integrity_band FROM public.proctoring_sessions s
                     WHERE ((rc.attempt_id IS NOT NULL AND s.attempt_id = rc.attempt_id)
                            OR (rc.interview_id IS NOT NULL AND s.interview_id = rc.interview_id))
                       AND s.integrity_score IS NOT NULL
                     ORDER BY s.integrity_score ASC LIMIT 1) ps ON true
  WHERE rc.job_role_id = _job_role_id
$$;

-- Pipeline table, server-side filtered, sorted and paginated. Refreshes progress for unfinished rows first.
-- _filters: { stages: [], scoreMin, scoreMax, integrityBands: [], search }
-- Returns { ok, access, total, counts: { stage: n }, rows: [...] }.
CREATE OR REPLACE FUNCTION public.b2b_role_pipeline(
  _actor UUID, _job_role_id UUID, _filters JSONB, _page INTEGER, _page_size INTEGER, _sort_by TEXT, _sort_dir TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_access TEXT := public._b2b_role_access(_actor, _job_role_id);
  v_id UUID;
  f JSONB := COALESCE(_filters, '{}'::jsonb);
  v_stages TEXT[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(f->'stages')), '{}');
  v_bands TEXT[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(f->'integrityBands')), '{}');
  v_min NUMERIC := NULLIF(f->>'scoreMin', '')::numeric;
  v_max NUMERIC := NULLIF(f->>'scoreMax', '')::numeric;
  v_search TEXT := NULLIF(btrim(COALESCE(f->>'search', '')), '');
  v_size INTEGER := LEAST(GREATEST(COALESCE(_page_size, 50), 1), 1000);
  v_off INTEGER := (GREATEST(COALESCE(_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(_page_size, 50), 1), 1000);
  v_desc BOOLEAN := lower(COALESCE(_sort_dir, 'desc')) <> 'asc';
  v_sort TEXT := COALESCE(_sort_by, 'match_score');
  v_total INTEGER;
  v_rows JSONB;
  v_counts JSONB;
BEGIN
  IF v_access IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF v_sort NOT IN ('full_name', 'stage', 'match_score', 'coding', 'interview', 'integrity', 'invited_at', 'completed_at') THEN
    v_sort := 'match_score';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  FOR v_id IN SELECT id FROM public.role_candidates
              WHERE job_role_id = _job_role_id AND completed_at IS NULL AND stage IN ('invited', 'in_progress')
              LIMIT 500 LOOP
    PERFORM public._b2b_rc_sync(v_id);
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(stage, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT b.stage, count(*) AS n FROM public._b2b_pipeline_base(_job_role_id) b GROUP BY b.stage) s;

  WITH filtered AS (
    SELECT * FROM public._b2b_pipeline_base(_job_role_id) p
    WHERE (cardinality(v_stages) = 0 OR p.stage = ANY (v_stages))
      AND (v_min IS NULL OR p.match_score >= v_min)
      AND (v_max IS NULL OR p.match_score <= v_max)
      AND (cardinality(v_bands) = 0 OR p.integrity_band = ANY (v_bands))
      AND (v_search IS NULL OR p.full_name ILIKE '%' || v_search || '%' OR p.email ILIKE '%' || v_search || '%')
  ), keyed AS (
    SELECT f.*,
      CASE v_sort WHEN 'match_score' THEN f.match_score WHEN 'coding' THEN f.coding WHEN 'interview' THEN f.interview
                  WHEN 'integrity' THEN f.integrity END AS n_key,
      CASE v_sort WHEN 'invited_at' THEN f.invited_at WHEN 'completed_at' THEN f.completed_at END AS t_key,
      CASE v_sort WHEN 'full_name' THEN lower(f.full_name) WHEN 'stage' THEN f.stage END AS s_key
    FROM filtered f
  ), ranked AS (
    SELECT k.*, row_number() OVER (ORDER BY
      CASE WHEN NOT v_desc THEN k.n_key END ASC NULLS LAST, CASE WHEN v_desc THEN k.n_key END DESC NULLS LAST,
      CASE WHEN NOT v_desc THEN k.t_key END ASC NULLS LAST, CASE WHEN v_desc THEN k.t_key END DESC NULLS LAST,
      CASE WHEN NOT v_desc THEN k.s_key END ASC NULLS LAST, CASE WHEN v_desc THEN k.s_key END DESC NULLS LAST,
      k.invited_at DESC, k.id) AS rn
    FROM keyed k
  )
  SELECT (SELECT count(*) FROM filtered),
         COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'n_key' - 't_key' - 's_key' - 'rn' ORDER BY r.rn)
                   FROM ranked r WHERE r.rn > v_off AND r.rn <= v_off + v_size), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object('ok', true, 'access', v_access, 'total', v_total, 'counts', v_counts, 'rows', v_rows);
END;
$$;

-- Decisions (bulk). Editors and hiring managers assigned to the role. advance → shortlisted, reject → rejected,
-- hire → hired, hold → back to completed (or the current pre-completion stage). History in role_candidate_decisions.
CREATE OR REPLACE FUNCTION public.b2b_decide(_actor UUID, _rc_ids UUID[], _decision TEXT, _note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; v_updated INTEGER := 0; v_skipped JSONB := '[]'::jsonb; v_id UUID;
BEGIN
  IF _decision NOT IN ('advance', 'hold', 'reject', 'hire') THEN
    RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_rc_ids) > 500 THEN RAISE EXCEPTION 'TOO_MANY' USING ERRCODE = 'check_violation'; END IF;
  -- Authorise every row before changing any.
  FOREACH v_id IN ARRAY _rc_ids LOOP
    SELECT * INTO rc FROM public.role_candidates WHERE id = v_id;
    IF NOT FOUND OR public._b2b_role_access(_actor, rc.job_role_id) IS NULL THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  PERFORM set_config('b2b.actor', _actor::text, true);
  FOREACH v_id IN ARRAY _rc_ids LOOP
    SELECT * INTO rc FROM public.role_candidates WHERE id = v_id FOR UPDATE;
    IF rc.stage = 'withdrawn' THEN
      v_skipped := v_skipped || jsonb_build_object('id', rc.id, 'reason', 'withdrawn'); CONTINUE;
    END IF;
    UPDATE public.role_candidates SET decision = _decision, decision_by = _actor, decision_at = now(),
      stage = CASE _decision WHEN 'advance' THEN 'shortlisted' WHEN 'reject' THEN 'rejected' WHEN 'hire' THEN 'hired'
                   ELSE CASE WHEN completed_at IS NOT NULL THEN 'completed'
                             WHEN stage IN ('invited', 'in_progress') THEN stage
                             WHEN started_at IS NOT NULL THEN 'in_progress' ELSE 'invited' END END
    WHERE id = rc.id;
    INSERT INTO public.role_candidate_decisions (org_id, role_candidate_id, decision, note, decided_by)
      VALUES (rc.org_id, rc.id, _decision, NULLIF(btrim(COALESCE(_note, '')), ''), _actor);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated, 'skipped', v_skipped);
END;
$$;

-- =============================================
-- 7. Share links
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_create_share_link(_actor UUID, _rc_id UUID, _token_hash TEXT, _days INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rc public.role_candidates; v_id UUID; v_exp TIMESTAMPTZ;
BEGIN
  SELECT * INTO rc FROM public.role_candidates WHERE id = _rc_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT public.actor_is_company_editor(_actor, rc.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _days IS NULL OR _days NOT BETWEEN 1 AND 30 THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_EXPIRY'); END IF;
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_TOKEN_HASH' USING ERRCODE = 'check_violation'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  INSERT INTO public.share_links (org_id, kind, target_id, token_hash, expires_at, created_by)
    VALUES (rc.org_id, 'candidate_report', rc.id, _token_hash, now() + make_interval(days => _days), _actor)
    RETURNING id, expires_at INTO v_id, v_exp;
  RETURN jsonb_build_object('ok', true, 'share_id', v_id, 'expires_at', v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_revoke_share_link(_actor UUID, _share_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.share_links;
BEGIN
  SELECT * INTO s FROM public.share_links WHERE id = _share_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT (public.actor_is_company_editor(_actor, s.org_id) OR s.created_by = _actor) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.share_links SET revoked_at = now() WHERE id = s.id AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Public (the token is the credential): view-only report, no contact details, comments, decisions or
-- proctoring session ids; integrity evidence images are not included. Each view is counted and audited.
CREATE OR REPLACE FUNCTION public.b2b_view_share(_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.share_links;
BEGIN
  SELECT * INTO s FROM public.share_links WHERE token_hash = _token_hash;
  IF NOT FOUND OR _token_hash IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF s.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF s.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  UPDATE public.share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = s.id;
  PERFORM public.b2b_audit(s.org_id, 'share_links.view', 'share_links', s.id::text, '{}'::jsonb);
  RETURN jsonb_build_object('status', 'ok', 'expires_at', s.expires_at, 'report', public._b2b_report_json(s.target_id, false));
END;
$$;

-- =============================================
-- Grants
-- =============================================
REVOKE EXECUTE ON FUNCTION
  public._b2b_role_access(UUID, UUID), public._b2b_candidate_cost(UUID), public._b2b_rc_sync(UUID),
  public._b2b_token_rc(TEXT, UUID), public._b2b_required_purposes(UUID), public._b2b_report_json(UUID, BOOLEAN),
  public._b2b_pipeline_base(UUID),
  public.job_roles_validate(), public.role_candidates_guard(), public.candidates_user_id_guard(), public.share_links_guard()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.actor_is_company_editor(UUID, UUID),
  public.b2b_invite_candidates(UUID, UUID, JSONB, TEXT), public.b2b_mark_candidate_email(UUID[], TEXT),
  public.b2b_reissue_candidate_invite(UUID, UUID, TEXT), public.b2b_claim_completion_notices(UUID),
  public.b2b_resolve_candidate_token(TEXT), public.b2b_claim_candidate_token(TEXT, UUID),
  public.b2b_candidate_state(TEXT, UUID), public.b2b_candidate_consent(TEXT, UUID, JSONB),
  public.b2b_candidate_system_checked(TEXT, UUID), public.b2b_candidate_report(UUID, UUID),
  public.b2b_store_matches(UUID, JSONB), public.b2b_match_inputs(UUID, UUID),
  public.b2b_role_pipeline(UUID, UUID, JSONB, INTEGER, INTEGER, TEXT, TEXT), public.b2b_decide(UUID, UUID[], TEXT, TEXT),
  public.b2b_create_share_link(UUID, UUID, TEXT, INTEGER), public.b2b_revoke_share_link(UUID, UUID),
  public.b2b_view_share(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.actor_is_company_editor(UUID, UUID),
  public.b2b_invite_candidates(UUID, UUID, JSONB, TEXT), public.b2b_mark_candidate_email(UUID[], TEXT),
  public.b2b_reissue_candidate_invite(UUID, UUID, TEXT), public.b2b_claim_completion_notices(UUID),
  public.b2b_resolve_candidate_token(TEXT), public.b2b_claim_candidate_token(TEXT, UUID),
  public.b2b_candidate_state(TEXT, UUID), public.b2b_candidate_consent(TEXT, UUID, JSONB),
  public.b2b_candidate_system_checked(TEXT, UUID), public.b2b_candidate_report(UUID, UUID),
  public.b2b_store_matches(UUID, JSONB), public.b2b_match_inputs(UUID, UUID),
  public.b2b_role_pipeline(UUID, UUID, JSONB, INTEGER, INTEGER, TEXT, TEXT), public.b2b_decide(UUID, UUID[], TEXT, TEXT),
  public.b2b_create_share_link(UUID, UUID, TEXT, INTEGER), public.b2b_revoke_share_link(UUID, UUID),
  public.b2b_view_share(TEXT)
  TO service_role;
