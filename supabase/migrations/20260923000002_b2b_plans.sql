-- B2B plans and entitlements (no payment integration).
-- Caps are enforced server-side:
--   * interviews per student: consume_interview_credit() — one atomic upsert, callable
--     only by the service role (the interview edge function), so a lab of 60 students
--     clicking Start together cannot overshoot the cap.
--   * max students per org: trigger on org_memberships, serialized per org.

CREATE TABLE public.plans (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name TEXT NOT NULL,
  interviews_per_student INTEGER NOT NULL CHECK (interviews_per_student >= 0),
  company_packs_enabled BOOLEAN NOT NULL DEFAULT false,
  dashboard_enabled BOOLEAN NOT NULL DEFAULT false,
  max_students INTEGER CHECK (max_students IS NULL OR max_students > 0), -- NULL = no cap
  price_inr_per_student NUMERIC(10, 2) NOT NULL DEFAULT 0,               -- for cost-vs-revenue reporting
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.plans (id, name, interviews_per_student, company_packs_enabled, dashboard_enabled, max_students, price_inr_per_student) VALUES
  ('pilot', 'Pilot', 6,  true,  true,  150,  0),
  ('basic', 'Basic', 4,  false, false, NULL, 0),
  ('pro',   'Pro',   10, true,  true,  NULL, 0);

ALTER TABLE public.organizations
  ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'pilot' REFERENCES public.plans(id),
  ADD COLUMN plan_starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN plan_ends_at TIMESTAMPTZ,
  ADD CONSTRAINT organizations_plan_window CHECK (plan_ends_at IS NULL OR plan_ends_at > plan_starts_at);

CREATE TABLE public.org_student_usage (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interviews_used INTEGER NOT NULL DEFAULT 0 CHECK (interviews_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_student_usage ENABLE ROW LEVEL SECURITY;

-- Staff can see the plan their org is on (features + price they agreed to);
-- students get what they need through my_interview_quota().
CREATE POLICY "Read plans" ON public.plans
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.organizations o WHERE o.plan_id = plans.id AND public.is_org_staff(o.id)
    )
  );
CREATE POLICY "Super-admin writes plans" ON public.plans
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Usage is read-only for everyone except the service role.
CREATE POLICY "Read usage" ON public.org_student_usage
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR user_id = auth.uid() OR public.is_org_staff(org_id)
  );

-- =============================================
-- Max students per org
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_max_students()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_max INTEGER;
  v_count INTEGER;
BEGIN
  IF NEW.role <> 'student' OR (TG_OP = 'UPDATE' AND OLD.role = 'student') THEN
    RETURN NEW;
  END IF;
  -- Serialize student additions per org so concurrent bulk inserts can't overshoot.
  PERFORM pg_advisory_xact_lock(hashtextextended('org_students:' || NEW.org_id::text, 0));
  SELECT p.max_students INTO v_max
    FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id
    WHERE o.id = NEW.org_id;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.org_memberships
    WHERE org_id = NEW.org_id AND role = 'student' AND id <> NEW.id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'STUDENT_LIMIT_REACHED: plan allows % students', v_max USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_memberships_max_students
  BEFORE INSERT OR UPDATE OF role ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_students();

-- =============================================
-- Interview credits (service role only)
-- =============================================
CREATE OR REPLACE FUNCTION public.consume_interview_credit(_org_id UUID, _user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_limit INTEGER;
  v_ends TIMESTAMPTZ;
  v_used INTEGER;
BEGIN
  SELECT p.interviews_per_student, o.plan_ends_at INTO v_limit, v_ends
    FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id
    WHERE o.id = _org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORG_NOT_FOUND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships WHERE org_id = _org_id AND user_id = _user_id AND role = 'student'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_A_STUDENT');
  END IF;
  IF v_ends IS NOT NULL AND v_ends <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PLAN_EXPIRED');
  END IF;
  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED', 'used', 0, 'limit', v_limit, 'remaining', 0);
  END IF;

  -- Single statement: the conflict path row-locks and re-checks the WHERE against
  -- the latest committed value, so concurrent calls can never exceed v_limit.
  INSERT INTO public.org_student_usage AS u (org_id, user_id, interviews_used)
    VALUES (_org_id, _user_id, 1)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET interviews_used = u.interviews_used + 1, updated_at = now()
    WHERE u.interviews_used < v_limit
  RETURNING u.interviews_used INTO v_used;

  IF v_used IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED', 'used', v_limit, 'limit', v_limit, 'remaining', 0);
  END IF;
  RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit, 'remaining', v_limit - v_used);
END;
$$;

-- Give a credit back when an interview fails to start (e.g. AI provider outage).
CREATE OR REPLACE FUNCTION public.refund_interview_credit(_org_id UUID, _user_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.org_student_usage
    SET interviews_used = interviews_used - 1, updated_at = now()
    WHERE org_id = _org_id AND user_id = _user_id AND interviews_used > 0
$$;

-- =============================================
-- Read models for the UI
-- =============================================
CREATE OR REPLACE FUNCTION public.my_interview_quota()
RETURNS TABLE (
  org_id UUID, org_name TEXT, plan_id TEXT, interviews_used INTEGER,
  interviews_limit INTEGER, interviews_remaining INTEGER, plan_ends_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.id, o.name, p.id,
         COALESCE(u.interviews_used, 0),
         p.interviews_per_student,
         GREATEST(p.interviews_per_student - COALESCE(u.interviews_used, 0), 0),
         o.plan_ends_at
  FROM public.org_memberships m
  JOIN public.organizations o ON o.id = m.org_id
  JOIN public.plans p ON p.id = o.plan_id
  LEFT JOIN public.org_student_usage u ON u.org_id = m.org_id AND u.user_id = m.user_id
  WHERE m.user_id = auth.uid() AND m.role = 'student'
$$;

CREATE OR REPLACE FUNCTION public.org_usage_summary(_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_staff(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT jsonb_build_object(
    'org_id', o.id,
    'plan', jsonb_build_object(
      'id', p.id, 'name', p.name, 'interviews_per_student', p.interviews_per_student,
      'company_packs_enabled', p.company_packs_enabled, 'dashboard_enabled', p.dashboard_enabled,
      'max_students', p.max_students),
    'plan_starts_at', o.plan_starts_at,
    'plan_ends_at', o.plan_ends_at,
    'students', (SELECT count(*) FROM public.org_memberships m WHERE m.org_id = o.id AND m.role = 'student'),
    'interviews_used', (SELECT COALESCE(sum(u.interviews_used), 0) FROM public.org_student_usage u WHERE u.org_id = o.id),
    'students_exhausted', (SELECT count(*) FROM public.org_student_usage u
                            WHERE u.org_id = o.id AND u.interviews_used >= p.interviews_per_student)
  ) INTO v
  FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id
  WHERE o.id = _org_id;
  RETURN v;
END;
$$;

-- Super-admin: attach an existing account to an org (e.g. the college TPO).
-- Students join through invites (Step 3), not this.
CREATE OR REPLACE FUNCTION public.super_add_org_member(
  _org_id UUID, _email TEXT, _role public.org_member_role, _full_name TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user UUID;
  v_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(_email)) LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: ask them to sign up at hiresume.in first' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.org_memberships (org_id, user_id, role, full_name, email)
    VALUES (_org_id, v_user, _role, _full_name, lower(btrim(_email)))
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, full_name = COALESCE(EXCLUDED.full_name, public.org_memberships.full_name)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated by default;
-- lock each one down explicitly.
REVOKE EXECUTE ON FUNCTION public.consume_interview_credit(UUID, UUID), public.refund_interview_credit(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_interview_credit(UUID, UUID), public.refund_interview_credit(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.my_interview_quota(), public.org_usage_summary(UUID),
  public.super_add_org_member(UUID, TEXT, public.org_member_role, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_interview_quota(), public.org_usage_summary(UUID),
  public.super_add_org_member(UUID, TEXT, public.org_member_role, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_max_students() FROM PUBLIC, anon, authenticated;
