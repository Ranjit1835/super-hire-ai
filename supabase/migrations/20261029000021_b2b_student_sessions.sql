-- R1.6 student sessions, built in the app (D3: Supabase's own session controls need the Pro plan). No credits are
-- involved (owner decision 2026-10-29); this is about account sharing and stale logins.
--  * A session is one Supabase login, identified by the JWT's session_id claim. Token refresh, reloads, reconnects
--    and extra tabs keep the same session_id, so they never look like a new login.
--  * One active session per student: the first sight of a new session_id ends the student's other open sessions
--    ('replaced'). The browser then revokes the other devices' refresh tokens (signOut scope 'others').
--  * Idle timeout (default 30 min since last activity) and absolute expiry (default 8 h since login) end a session.
--    Per org overrides: organizations.settings.session_idle_min / session_max_hours.
--  * Enforced server-side: every B2B edge function calls b2b_session_touch for students (b2b-http.ts), and the
--    browser heartbeat calls b2b_session_heartbeat. Staff, candidates and B2C users are not affected.
-- Rollback: DROP FUNCTION public.b2b_session_heartbeat(), public.b2b_session_touch(uuid, text), public.b2b_session_end();
-- DROP TABLE public.b2b_sessions.

CREATE TABLE IF NOT EXISTS public.b2b_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IN ('logout', 'idle', 'expired', 'replaced')),
  UNIQUE (user_id, auth_session_id)
);
CREATE INDEX IF NOT EXISTS idx_b2b_sessions_open ON public.b2b_sessions (user_id) WHERE ended_at IS NULL;
ALTER TABLE public.b2b_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own sessions" ON public.b2b_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());
-- No client write policies: only the definer functions below write.

-- Validate (and register / refresh) a student's session. Returns { ok, student, reason?, started? }.
-- Non-students always get { ok: true, student: false } and nothing is recorded.
CREATE OR REPLACE FUNCTION public.b2b_session_touch(_user_id UUID, _auth_session_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.b2b_sessions;
  v_org UUID;
  v_idle INTEGER;
  v_max INTEGER;
BEGIN
  SELECT m.org_id INTO v_org FROM public.org_memberships m
    WHERE m.user_id = _user_id AND m.role = 'student' ORDER BY m.created_at LIMIT 1;
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', true, 'student', false); END IF;
  IF NULLIF(btrim(_auth_session_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'student', true, 'reason', 'NO_SESSION');
  END IF;
  SELECT COALESCE(NULLIF(o.settings->>'session_idle_min', '')::int, 30), COALESCE(NULLIF(o.settings->>'session_max_hours', '')::int, 8)
    INTO v_idle, v_max FROM public.organizations o WHERE o.id = v_org;

  -- Serialise per student so two first requests of a new login don't both "replace" each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('b2b_session:' || _user_id::text, 0));
  SELECT * INTO s FROM public.b2b_sessions WHERE user_id = _user_id AND auth_session_id = _auth_session_id FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.b2b_sessions SET ended_at = now(), end_reason = 'replaced'
      WHERE user_id = _user_id AND ended_at IS NULL;
    INSERT INTO public.b2b_sessions (user_id, auth_session_id) VALUES (_user_id, _auth_session_id);
    RETURN jsonb_build_object('ok', true, 'student', true, 'started', true);
  END IF;

  IF s.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'student', true, 'reason', upper(s.end_reason));
  END IF;
  IF now() - s.started_at >= make_interval(hours => v_max) THEN
    UPDATE public.b2b_sessions SET ended_at = now(), end_reason = 'expired' WHERE id = s.id;
    RETURN jsonb_build_object('ok', false, 'student', true, 'reason', 'EXPIRED');
  END IF;
  IF now() - s.last_seen_at >= make_interval(mins => v_idle) THEN
    UPDATE public.b2b_sessions SET ended_at = now(), end_reason = 'idle' WHERE id = s.id;
    RETURN jsonb_build_object('ok', false, 'student', true, 'reason', 'IDLE');
  END IF;
  UPDATE public.b2b_sessions SET last_seen_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'student', true, 'started', false);
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_session_touch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_session_touch(UUID, TEXT) TO service_role;

-- The JWT's session_id claim for the current request (PostgREST sets request.jwt.claims).
CREATE OR REPLACE FUNCTION public.b2b_current_auth_session()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'session_id',
                  NULLIF(current_setting('request.jwt.claim.session_id', true), ''))
$$;

-- Browser heartbeat (signed-in user, own session only).
CREATE OR REPLACE FUNCTION public.b2b_session_heartbeat()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN public.b2b_session_touch(auth.uid(), public.b2b_current_auth_session());
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_session_heartbeat() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_session_heartbeat() TO authenticated;

-- Logout: end the current session (idempotent).
CREATE OR REPLACE FUNCTION public.b2b_session_end()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.b2b_sessions SET ended_at = now(), end_reason = 'logout'
    WHERE user_id = auth.uid() AND auth_session_id = public.b2b_current_auth_session() AND ended_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_session_end() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_session_end() TO authenticated;
