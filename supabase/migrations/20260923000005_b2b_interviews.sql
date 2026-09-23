-- B2B adaptive interviews.
-- The server owns the transcript and the state machine; the browser only submits
-- the latest answer with a client_turn_id (idempotency key) and the turn number it
-- is answering (optimistic concurrency). All writes go through the service-role-only
-- functions below, called by the b2b-interview edge function.

CREATE TYPE public.b2b_interview_status AS ENUM ('in_progress', 'completed', 'abandoned', 'cancelled');

ALTER TABLE public.interview_modules ADD CONSTRAINT interview_modules_id_org_key UNIQUE (id, org_id);

CREATE TABLE public.b2b_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id UUID NOT NULL,
  module_version INTEGER NOT NULL,
  module_spec JSONB NOT NULL,             -- snapshot: results always reference the exact spec used
  state JSONB NOT NULL,                   -- engine state, persisted after every answer
  status public.b2b_interview_status NOT NULL DEFAULT 'in_progress',
  end_reason TEXT CHECK (end_reason IN ('topics_covered', 'max_turns', 'time_limit', 'student_ended', 'abandoned', 'cancelled')),
  prompt_version TEXT NOT NULL,
  client_meta JSONB NOT NULL DEFAULT '{}'::jsonb, -- browser, STT language, input mode
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (module_id, org_id) REFERENCES public.interview_modules(id, org_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id)
);

-- One live interview per student at a time (resume instead of starting twice).
CREATE UNIQUE INDEX idx_b2b_interviews_one_live ON public.b2b_interviews(user_id) WHERE status = 'in_progress';
CREATE INDEX idx_b2b_interviews_org ON public.b2b_interviews(org_id, started_at DESC);
CREATE INDEX idx_b2b_interviews_user ON public.b2b_interviews(user_id, started_at DESC);
CREATE INDEX idx_b2b_interviews_stale ON public.b2b_interviews(deadline_at) WHERE status = 'in_progress';

CREATE TABLE public.b2b_interview_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL,
  org_id UUID NOT NULL,
  turn_index INTEGER NOT NULL CHECK (turn_index >= 1), -- question number
  role TEXT NOT NULL CHECK (role IN ('interviewer', 'student')),
  content TEXT NOT NULL CHECK (length(content) <= 6000),
  topic TEXT,
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,  -- student: timing/STT metrics; interviewer: in-turn assessment, LLM usage
  client_turn_id UUID,                      -- student turns only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (interview_id, org_id) REFERENCES public.b2b_interviews(id, org_id) ON DELETE CASCADE,
  UNIQUE (interview_id, turn_index, role),
  UNIQUE (interview_id, client_turn_id)
);
CREATE INDEX idx_b2b_turns_interview ON public.b2b_interview_turns(interview_id, turn_index);

ALTER TABLE public.b2b_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_interview_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read interviews" ON public.b2b_interviews
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_org_staff(org_id) OR public.is_super_admin()
  );
CREATE POLICY "Read interview turns" ON public.b2b_interview_turns
  FOR SELECT TO authenticated USING (
    public.is_org_staff(org_id) OR public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.b2b_interviews i WHERE i.id = interview_id AND i.user_id = auth.uid())
  );
-- No INSERT/UPDATE/DELETE policies: writes only via the functions below (service role).

-- =============================================
-- Stale interviews: abandoned 30 minutes after their deadline
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_expire_stale_interviews()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH x AS (
    UPDATE public.b2b_interviews
      SET status = 'abandoned', end_reason = 'abandoned', completed_at = now()
      WHERE status = 'in_progress' AND deadline_at < now() - interval '30 minutes'
      RETURNING 1
  )
  SELECT count(*)::int FROM x
$$;

-- =============================================
-- Start: validate, consume a credit, snapshot the module, create the interview.
-- Returns { ok, interview_id, resumed } or { ok:false, reason, ... }.
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_start_interview(
  _user_id UUID, _module_id UUID, _module_version INTEGER, _initial_state JSONB,
  _prompt_version TEXT, _client_meta JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.interview_modules;
  live public.b2b_interviews;
  credit JSONB;
  v_id UUID;
BEGIN
  -- Serialize starts per student (double-clicks, two tabs).
  PERFORM pg_advisory_xact_lock(hashtextextended('b2b_start:' || _user_id::text, 0));
  PERFORM public.b2b_expire_stale_interviews();

  SELECT * INTO live FROM public.b2b_interviews WHERE user_id = _user_id AND status = 'in_progress';
  IF FOUND THEN
    IF live.module_id = _module_id THEN
      RETURN jsonb_build_object('ok', true, 'interview_id', live.id, 'resumed', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_IN_PROGRESS', 'interview_id', live.id, 'module_id', live.module_id);
  END IF;

  SELECT * INTO m FROM public.interview_modules WHERE id = _module_id;
  IF NOT FOUND OR m.org_id IS NULL OR NOT m.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MODULE_UNAVAILABLE');
  END IF;
  IF m.version <> _module_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MODULE_CHANGED');
  END IF;
  IF m.type = 'company_pack' AND NOT public.org_has_company_packs(m.org_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MODULE_UNAVAILABLE');
  END IF;

  credit := public.consume_interview_credit(m.org_id, _user_id); -- also checks student membership + plan window
  IF NOT (credit->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', credit->>'reason', 'credit', credit);
  END IF;

  INSERT INTO public.b2b_interviews
    (org_id, user_id, module_id, module_version, module_spec, state, prompt_version, client_meta, deadline_at)
  VALUES
    (m.org_id, _user_id, m.id, m.version, m.spec, _initial_state, _prompt_version, coalesce(_client_meta, '{}'::jsonb),
     now() + make_interval(mins => (m.spec->>'max_minutes')::int))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'interview_id', v_id, 'resumed', false, 'credit', credit);
END;
$$;

-- First question after start (separate so the LLM call happens outside the start transaction).
-- If the LLM fails, the edge function calls b2b_cancel_failed_start() (refunds the credit).
CREATE OR REPLACE FUNCTION public.b2b_record_opening(
  _interview_id UUID, _question TEXT, _meta JSONB, _state JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.status <> 'in_progress' THEN RAISE EXCEPTION 'NOT_IN_PROGRESS'; END IF;
  INSERT INTO public.b2b_interview_turns (interview_id, org_id, turn_index, role, content, topic, difficulty, meta)
    VALUES (iv.id, iv.org_id, 1, 'interviewer', _question, _state->>'current_topic', _state->>'difficulty', coalesce(_meta, '{}'::jsonb))
    ON CONFLICT (interview_id, turn_index, role) DO NOTHING;
  UPDATE public.b2b_interviews SET state = _state, last_activity_at = now() WHERE id = iv.id;
END;
$$;

-- =============================================
-- Record one answered turn atomically.
-- _next_question NULL when the interview ends without a follow-up (closing line is
-- still stored as the interviewer's final turn when provided).
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_record_turn(
  _interview_id UUID, _user_id UUID, _expected_turn_count INTEGER, _client_turn_id UUID,
  _answer TEXT, _answer_meta JSONB, _answer_topic TEXT, _answer_difficulty TEXT,
  _next_question TEXT, _next_meta JSONB, _state JSONB, _end_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
  v_turn INTEGER;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.user_id <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.b2b_interview_turns WHERE interview_id = iv.id AND client_turn_id = _client_turn_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF iv.status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_IN_PROGRESS', 'status', iv.status);
  END IF;
  IF (iv.state->>'turn_count')::int <> _expected_turn_count THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TURN_CONFLICT', 'turn_count', (iv.state->>'turn_count')::int);
  END IF;

  v_turn := _expected_turn_count + 1;
  INSERT INTO public.b2b_interview_turns
    (interview_id, org_id, turn_index, role, content, topic, difficulty, meta, client_turn_id)
  VALUES (iv.id, iv.org_id, v_turn, 'student', _answer, _answer_topic, _answer_difficulty, coalesce(_answer_meta, '{}'::jsonb), _client_turn_id);

  IF _next_question IS NOT NULL THEN
    INSERT INTO public.b2b_interview_turns (interview_id, org_id, turn_index, role, content, topic, difficulty, meta)
    VALUES (iv.id, iv.org_id, v_turn + 1, 'interviewer', _next_question, _state->>'current_topic', _state->>'difficulty',
            coalesce(_next_meta, '{}'::jsonb));
  END IF;

  UPDATE public.b2b_interviews SET
    state = _state,
    last_activity_at = now(),
    status = CASE WHEN _end_reason IS NULL THEN 'in_progress' ELSE 'completed' END::public.b2b_interview_status,
    end_reason = _end_reason,
    completed_at = CASE WHEN _end_reason IS NULL THEN NULL ELSE now() END
  WHERE id = iv.id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

-- Student ends early (or time ran out while they were away). With no answers yet it's a
-- cancellation and the credit is refunded.
CREATE OR REPLACE FUNCTION public.b2b_end_interview(
  _interview_id UUID, _user_id UUID, _state JSONB, _reason TEXT DEFAULT 'student_ended'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
  v_answers INTEGER;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.user_id <> _user_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF iv.status <> 'in_progress' THEN RETURN jsonb_build_object('ok', true, 'status', iv.status, 'already', true); END IF;
  SELECT count(*) INTO v_answers FROM public.b2b_interview_turns WHERE interview_id = iv.id AND role = 'student';
  IF _reason NOT IN ('student_ended', 'time_limit') THEN RAISE EXCEPTION 'INVALID_REASON'; END IF;
  IF v_answers = 0 THEN
    UPDATE public.b2b_interviews SET status = 'cancelled', end_reason = 'cancelled', completed_at = now() WHERE id = iv.id;
    PERFORM public.refund_interview_credit(iv.org_id, iv.user_id);
    RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'refunded', true);
  END IF;
  UPDATE public.b2b_interviews
    SET status = 'completed', end_reason = _reason, completed_at = now(), state = coalesce(_state, state)
    WHERE id = iv.id;
  RETURN jsonb_build_object('ok', true, 'status', 'completed', 'refunded', false);
END;
$$;

-- Opening question failed (LLM outage): cancel and refund.
CREATE OR REPLACE FUNCTION public.b2b_cancel_failed_start(_interview_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.status <> 'in_progress' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.b2b_interview_turns WHERE interview_id = iv.id) THEN RETURN; END IF;
  UPDATE public.b2b_interviews SET status = 'cancelled', end_reason = 'cancelled', completed_at = now() WHERE id = iv.id;
  PERFORM public.refund_interview_credit(iv.org_id, iv.user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.b2b_expire_stale_interviews(),
  public.b2b_start_interview(UUID, UUID, INTEGER, JSONB, TEXT, JSONB),
  public.b2b_record_opening(UUID, TEXT, JSONB, JSONB),
  public.b2b_record_turn(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT),
  public.b2b_end_interview(UUID, UUID, JSONB, TEXT),
  public.b2b_cancel_failed_start(UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_expire_stale_interviews(),
  public.b2b_start_interview(UUID, UUID, INTEGER, JSONB, TEXT, JSONB),
  public.b2b_record_opening(UUID, TEXT, JSONB, JSONB),
  public.b2b_record_turn(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT),
  public.b2b_end_interview(UUID, UUID, JSONB, TEXT),
  public.b2b_cancel_failed_start(UUID)
TO service_role;
