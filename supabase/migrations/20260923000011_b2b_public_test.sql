-- B2B public readiness test (Step 10).
-- Visitors to /test/{org-slug} get a Supabase *anonymous* session, so the existing interview
-- engine, evaluator, RLS and cost logging work unchanged. Public tests are separate from
-- student practice: kind = 'public_test', linked to a lead, no student credit, excluded from
-- the batch dashboard. Abuse/cost controls are enforced here, not in the browser.

-- ── Org settings ──────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN public_test_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN public_test_monthly_cap INTEGER NOT NULL DEFAULT 100 CHECK (public_test_monthly_cap BETWEEN 0 AND 100000),
  ADD COLUMN public_test_cta_label TEXT CHECK (public_test_cta_label IS NULL OR length(public_test_cta_label) <= 60),
  ADD COLUMN public_test_cta_url TEXT CHECK (public_test_cta_url IS NULL OR public_test_cta_url ~ '^(https://|tel:|mailto:)' AND length(public_test_cta_url) <= 300);

ALTER TABLE public.interview_modules ADD COLUMN public_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.b2b_interviews
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice' CHECK (kind IN ('practice', 'public_test')),
  ADD COLUMN lead_id UUID;

-- ── Leads ────────────────────────────────────────────────────────────────────
CREATE TABLE public.org_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 100),
  phone TEXT NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  target_course TEXT CHECK (target_course IS NULL OR length(target_course) <= 100),
  module_id UUID REFERENCES public.interview_modules(id) ON DELETE SET NULL,
  interview_id UUID,
  anon_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'enrolled', 'not_interested')),
  overall_score NUMERIC(4, 1),
  readiness_level TEXT CHECK (readiness_level IN ('not_ready', 'developing', 'ready')),
  primary_gap TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_leads_org ON public.org_leads(org_id, created_at DESC);

ALTER TABLE public.b2b_interviews
  ADD CONSTRAINT b2b_interviews_lead_fk FOREIGN KEY (lead_id) REFERENCES public.org_leads(id) ON DELETE SET NULL;

CREATE TRIGGER update_org_leads_updated_at BEFORE UPDATE ON public.org_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Only status may change after creation (by org admins); contact details are immutable.
CREATE OR REPLACE FUNCTION public.org_leads_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.org_id, NEW.full_name, NEW.phone, NEW.email, NEW.target_course, NEW.consent_version, NEW.consent_text, NEW.created_at,
      NEW.module_id, NEW.interview_id, NEW.anon_user_id, NEW.overall_score, NEW.readiness_level, NEW.primary_gap)
     IS DISTINCT FROM (OLD.org_id, OLD.full_name, OLD.phone, OLD.email, OLD.target_course, OLD.consent_version, OLD.consent_text, OLD.created_at,
      OLD.module_id, OLD.interview_id, OLD.anon_user_id, OLD.overall_score, OLD.readiness_level, OLD.primary_gap)
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Only a lead''s status can be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER org_leads_guard BEFORE UPDATE ON public.org_leads FOR EACH ROW EXECUTE FUNCTION public.org_leads_guard();

ALTER TABLE public.org_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read leads" ON public.org_leads FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_org_staff(org_id));
CREATE POLICY "Org admin updates lead status" ON public.org_leads FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));

-- ── Rate limiting (hashes only) ─────────────────────────────────────────────
CREATE TABLE public.b2b_public_test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  ip_hash TEXT,
  lead_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pta_org_time ON public.b2b_public_test_attempts(org_id, created_at);
CREATE INDEX idx_pta_ip_time ON public.b2b_public_test_attempts(ip_hash, created_at);
ALTER TABLE public.b2b_public_test_attempts ENABLE ROW LEVEL SECURITY; -- no policies: service role only

-- Keep only 60 days of attempts.
CREATE OR REPLACE FUNCTION public.b2b_prune_public_test_attempts()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM public.b2b_public_test_attempts WHERE created_at < now() - interval '60 days' RETURNING 1)
  SELECT count(*)::int FROM d
$$;

-- ── Public info for /test/{slug} (callable by anyone) ───────────────────────
CREATE OR REPLACE FUNCTION public.public_test_info(_slug TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'org', jsonb_build_object('name', o.name, 'slug', o.slug, 'type', o.type, 'logo_url', o.logo_url, 'is_demo', o.is_demo,
                              'cta_label', o.public_test_cta_label, 'cta_url', o.public_test_cta_url),
    'available', o.public_test_enabled AND (o.plan_ends_at IS NULL OR o.plan_ends_at > now())
                 AND (SELECT count(*) FROM public.b2b_interviews i
                      WHERE i.org_id = o.id AND i.kind = 'public_test' AND i.status <> 'cancelled'
                        AND i.started_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
                     < o.public_test_monthly_cap,
    'modules', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'type', m.type, 'description', m.spec->>'description',
        'minutes', least((m.spec->>'max_minutes')::int, 10), 'questions', least((m.spec->>'max_turns')::int, 6)) ORDER BY m.name)
      FROM public.interview_modules m
      WHERE m.org_id = o.id AND m.is_active AND m.public_test
        AND (m.type <> 'company_pack' OR public.org_has_company_packs(o.id))
    ), '[]'::jsonb)
  )
  FROM public.organizations o
  WHERE o.slug = lower(btrim(_slug)) AND o.public_test_enabled
$$;
REVOKE EXECUTE ON FUNCTION public.public_test_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_test_info(TEXT) TO anon, authenticated;

-- ── Start a public test (service role; called by the b2b-public-test function) ───
-- Returns { ok, interview_id, lead_id } or { ok:false, reason }.
CREATE OR REPLACE FUNCTION public.b2b_start_public_test(
  _user_id UUID, _slug TEXT, _module_id UUID, _module_version INTEGER, _initial_state JSONB, _prompt_version TEXT,
  _full_name TEXT, _phone TEXT, _email TEXT, _target_course TEXT,
  _phone_hash TEXT, _email_hash TEXT, _ip_hash TEXT,
  _consent_version TEXT, _consent_text TEXT, _client_meta JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.organizations;
  m public.interview_modules;
  v_spec JSONB;
  v_lead UUID;
  v_iv UUID;
  v_month_start TIMESTAMPTZ := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  SELECT * INTO o FROM public.organizations WHERE slug = lower(btrim(_slug)) FOR UPDATE; -- serialises the cap check
  IF NOT FOUND OR NOT o.public_test_enabled THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AVAILABLE'); END IF;
  IF o.plan_ends_at IS NOT NULL AND o.plan_ends_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AVAILABLE'); END IF;
  IF coalesce(btrim(_consent_version), '') = '' OR coalesce(btrim(_consent_text), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CONSENT_REQUIRED');
  END IF;

  SELECT * INTO m FROM public.interview_modules WHERE id = _module_id AND org_id = o.id;
  IF NOT FOUND OR NOT m.is_active OR NOT m.public_test
     OR (m.type = 'company_pack' AND NOT public.org_has_company_packs(o.id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MODULE_UNAVAILABLE');
  END IF;
  IF m.version <> _module_version THEN RETURN jsonb_build_object('ok', false, 'reason', 'MODULE_CHANGED'); END IF;

  -- A visitor session runs one test at a time.
  IF EXISTS (SELECT 1 FROM public.b2b_interviews WHERE user_id = _user_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'IN_PROGRESS');
  END IF;

  -- Cost controls.
  IF (SELECT count(*) FROM public.b2b_interviews WHERE org_id = o.id AND kind = 'public_test' AND status <> 'cancelled' AND started_at >= v_month_start)
     >= o.public_test_monthly_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MONTHLY_CAP');
  END IF;
  IF (SELECT count(*) FROM public.b2b_public_test_attempts
      WHERE org_id = o.id AND (phone_hash = _phone_hash OR email_hash = _email_hash) AND created_at > now() - interval '30 days') >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_TAKEN');
  END IF;
  IF _ip_hash IS NOT NULL AND (
       (SELECT count(*) FROM public.b2b_public_test_attempts WHERE org_id = o.id AND ip_hash = _ip_hash AND created_at > now() - interval '1 day') >= 5
    OR (SELECT count(*) FROM public.b2b_public_test_attempts WHERE ip_hash = _ip_hash AND created_at > now() - interval '1 day') >= 20) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.org_leads (org_id, full_name, phone, email, target_course, module_id, anon_user_id, consent_version, consent_text)
    VALUES (o.id, btrim(_full_name), _phone, lower(btrim(_email)), nullif(btrim(_target_course), ''), m.id, _user_id, _consent_version, _consent_text)
    RETURNING id INTO v_lead;

  INSERT INTO public.b2b_public_test_attempts (org_id, phone_hash, email_hash, ip_hash, lead_id)
    VALUES (o.id, _phone_hash, _email_hash, _ip_hash, v_lead);

  -- Short version of the module: at most 6 questions / 10 minutes.
  v_spec := m.spec
    || jsonb_build_object('max_turns', least((m.spec->>'max_turns')::int, 6))
    || jsonb_build_object('max_minutes', least((m.spec->>'max_minutes')::int, 10));

  INSERT INTO public.b2b_interviews
    (org_id, user_id, module_id, module_version, module_spec, state, prompt_version, client_meta, deadline_at, kind, lead_id)
  VALUES
    (o.id, _user_id, m.id, m.version, v_spec, _initial_state, _prompt_version, coalesce(_client_meta, '{}'::jsonb),
     now() + make_interval(mins => (v_spec->>'max_minutes')::int), 'public_test', v_lead)
  RETURNING id INTO v_iv;

  UPDATE public.org_leads SET interview_id = v_iv WHERE id = v_lead;
  RETURN jsonb_build_object('ok', true, 'interview_id', v_iv, 'lead_id', v_lead);
END;
$$;
-- The opening question failed (AI outage): cancel, and don't count it against the visitor or the cap.
CREATE OR REPLACE FUNCTION public.b2b_public_test_failed_start(_interview_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id AND kind = 'public_test' FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.b2b_interview_turns WHERE interview_id = iv.id) THEN RETURN; END IF;
  UPDATE public.b2b_interviews SET status = 'cancelled', end_reason = 'cancelled', completed_at = now() WHERE id = iv.id;
  DELETE FROM public.b2b_public_test_attempts WHERE lead_id = iv.lead_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.b2b_public_test_failed_start(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_public_test_failed_start(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.b2b_start_public_test(UUID, TEXT, UUID, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB),
  public.b2b_prune_public_test_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_start_public_test(UUID, TEXT, UUID, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB),
  public.b2b_prune_public_test_attempts() TO service_role;

-- ── Org admin: public test settings (organizations itself is super-admin-write) ──
CREATE OR REPLACE FUNCTION public.org_update_public_test_settings(
  _org_id UUID, _enabled BOOLEAN, _cta_label TEXT, _cta_url TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_admin(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.organizations SET
    public_test_enabled = _enabled,
    public_test_cta_label = nullif(btrim(_cta_label), ''),
    public_test_cta_url = nullif(btrim(_cta_url), '')
  WHERE id = _org_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_update_public_test_settings(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_update_public_test_settings(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_public_test_usage(_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_staff(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'enabled', o.public_test_enabled, 'monthly_cap', o.public_test_monthly_cap,
      'used_this_month', (SELECT count(*) FROM public.b2b_interviews i WHERE i.org_id = o.id AND i.kind = 'public_test' AND i.status <> 'cancelled'
                          AND i.started_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),
      'cta_label', o.public_test_cta_label, 'cta_url', o.public_test_cta_url, 'slug', o.slug)
    FROM public.organizations o WHERE o.id = _org_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_public_test_usage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_public_test_usage(UUID) TO authenticated;

-- ── Keep lead results in sync with the evaluation (hooked into the save path) ──
CREATE OR REPLACE FUNCTION public.b2b_sync_lead_result()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE public.org_leads l SET overall_score = NEW.overall_score, readiness_level = NEW.readiness_level, primary_gap = NEW.primary_gap
    FROM public.b2b_interviews i
    WHERE i.id = NEW.interview_id AND i.lead_id = l.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER b2b_evaluations_sync_lead AFTER INSERT OR UPDATE OF status ON public.b2b_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.b2b_sync_lead_result();

-- ── Public tests stay out of the student dashboard ──────────────────────────
CREATE OR REPLACE FUNCTION public.org_dashboard_evaluations(_org_id UUID)
RETURNS TABLE (
  interview_id UUID, user_id UUID, module_id UUID, module_name TEXT, module_type TEXT,
  pass_threshold NUMERIC, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  overall_score NUMERIC, readiness_level TEXT, primary_gap TEXT,
  dimensions JSONB, per_topic JSONB
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_staff(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_super_admin() AND NOT coalesce((
    SELECT p.dashboard_enabled FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id WHERE o.id = _org_id
  ), false) THEN
    RAISE EXCEPTION 'PLAN_FEATURE: the batch dashboard is not included in this plan' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (e.interview_id) e.*
    FROM public.b2b_evaluations e
    WHERE e.org_id = _org_id AND e.status = 'completed'
    ORDER BY e.interview_id, e.completed_at DESC
  )
  SELECT
    l.interview_id, l.user_id, l.module_id,
    i.module_spec->>'name', i.module_spec->>'type', (i.module_spec->>'pass_threshold')::numeric,
    i.started_at, l.completed_at, l.overall_score, l.readiness_level, l.primary_gap,
    coalesce((SELECT jsonb_object_agg(d.key, CASE WHEN jsonb_typeof(d.value->'score') = 'number' THEN d.value->'score' ELSE 'null'::jsonb END)
              FROM jsonb_each(l.result->'dimensions') d), '{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(t.key, CASE WHEN jsonb_typeof(t.value->'score') = 'number' THEN t.value->'score' ELSE 'null'::jsonb END)
              FROM jsonb_each(l.result->'per_topic') t), '{}'::jsonb)
  FROM latest l
  JOIN public.b2b_interviews i ON i.id = l.interview_id
  WHERE i.kind = 'practice'
  ORDER BY i.started_at;
END;
$$;
