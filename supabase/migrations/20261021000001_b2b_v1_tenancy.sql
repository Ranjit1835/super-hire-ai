-- B2B V1 — tenancy reshape (Phase 1).
-- Reshapes the pilot tables in place (they are empty in production): no parallel tables.
--   * organizations.type and org_memberships.role: Postgres enums → text + CHECK, so role and type
--     changes stay reversible (an enum value can't be removed).
--   * org types: college, company (+ legacy coaching_institute, kept for the pilot's public test).
--   * roles: org_admin (TPO admin in a college, company admin in a company), trainer, student,
--     recruiter, hiring_manager; a trigger keeps roles consistent with the org type.
--   * organizations: status, seat limit, contacts, settings, pooled credit balance.
--   * org_credit_ledger: every credit movement; balance changes only through the functions below.
--   * audit_logs: append-only, written by triggers and functions.
--   * org_consents: itemised by purpose, with withdrawal.
--   * org_invites: also invite staff (org_admin, trainer, recruiter, hiring_manager).
-- Super admin stays user_roles.role = 'admin', granted only by a one-time SQL statement the owner runs.

-- =============================================
-- Enums → text + CHECK
-- =============================================
ALTER TABLE public.organizations ALTER COLUMN type TYPE TEXT USING type::text;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_type_check CHECK (type IN ('college', 'company', 'coaching_institute'));

-- The pilot's max-students trigger is defined ON UPDATE OF role, which blocks a type change.
DROP TRIGGER org_memberships_max_students ON public.org_memberships;
ALTER TABLE public.org_memberships ALTER COLUMN role TYPE TEXT USING role::text;
CREATE TRIGGER org_memberships_max_students
  BEFORE INSERT OR UPDATE OF role ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_students();
ALTER TABLE public.org_memberships
  ADD CONSTRAINT org_memberships_role_check
  CHECK (role IN ('org_admin', 'trainer', 'student', 'recruiter', 'hiring_manager'));

-- Functions whose signatures named the enum types are recreated with text.
DROP FUNCTION public.super_add_org_member(UUID, TEXT, public.org_member_role, TEXT);
DROP FUNCTION public.org_role_of(UUID);

CREATE FUNCTION public.org_role_of(_org_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.org_memberships WHERE org_id = _org_id AND user_id = auth.uid()
$$;

-- b2b_accept_invite declared a variable of the enum type: recreated further down.
DROP TYPE public.org_member_role;
DROP TYPE public.org_type;

-- Staff = everyone who works for the org (not students). Hiring managers are narrowed per job role
-- in the programs migration (can_view_job_role).
CREATE OR REPLACE FUNCTION public.is_org_staff(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.org_role_of(_org_id) IN ('org_admin', 'trainer', 'recruiter', 'hiring_manager'), false)
$$;

-- Staff who manage content (assessments, drives, job roles, candidates); hiring managers only review.
CREATE OR REPLACE FUNCTION public.is_org_editor(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.org_role_of(_org_id) IN ('org_admin', 'trainer', 'recruiter'), false)
$$;

-- Service-role callers pass the actor explicitly.
CREATE OR REPLACE FUNCTION public.actor_org_role(_actor UUID, _org_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.org_memberships WHERE org_id = _org_id AND user_id = _actor
$$;

CREATE OR REPLACE FUNCTION public.actor_is_super_admin(_actor UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION public.actor_is_org_editor(_actor UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.actor_is_super_admin(_actor)
      OR COALESCE(public.actor_org_role(_actor, _org_id) IN ('org_admin', 'trainer', 'recruiter'), false)
$$;

-- Roles must fit the org type.
CREATE OR REPLACE FUNCTION public.b2b_role_fits_org(_role TEXT, _org_type TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _org_type
    WHEN 'company' THEN _role IN ('org_admin', 'recruiter', 'hiring_manager')
    ELSE _role IN ('org_admin', 'trainer', 'student')
  END
$$;

CREATE OR REPLACE FUNCTION public.org_memberships_role_fits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_type TEXT;
BEGIN
  SELECT type INTO v_type FROM public.organizations WHERE id = NEW.org_id;
  IF NOT public.b2b_role_fits_org(NEW.role, v_type) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED: role % is not valid in a % org', NEW.role, v_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER org_memberships_role_fits
  BEFORE INSERT OR UPDATE OF role ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.org_memberships_role_fits();

-- The org type can't change once it has members (their roles depend on it).
CREATE OR REPLACE FUNCTION public.organizations_type_locked()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type
     AND EXISTS (SELECT 1 FROM public.org_memberships WHERE org_id = OLD.id) THEN
    RAISE EXCEPTION 'ORG_TYPE_LOCKED: an org with members cannot change type' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organizations_type_locked
  BEFORE UPDATE OF type ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_type_locked();

-- =============================================
-- Organizations: V1 columns
-- =============================================
-- valid_from / valid_to of the spec are the existing plan_starts_at / plan_ends_at.
ALTER TABLE public.organizations
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  ADD COLUMN seat_limit INTEGER CHECK (seat_limit IS NULL OR seat_limit > 0),
  ADD COLUMN contact_name TEXT CHECK (contact_name IS NULL OR length(contact_name) <= 200),
  ADD COLUMN contact_email TEXT CHECK (contact_email IS NULL OR contact_email = lower(btrim(contact_email))),
  ADD COLUMN contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) <= 30),
  ADD COLUMN address TEXT CHECK (address IS NULL OR length(address) <= 500),
  -- enabled_modules, quotas, proctoring_default, results_release_default, retention_days; see b2b_org_settings().
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  -- Pooled credits (1 credit = one 20-minute practice interview). Changed only by the credit functions.
  ADD COLUMN credits_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (credits_balance >= 0);

-- Settings with defaults filled in: the one place that knows the defaults.
CREATE OR REPLACE FUNCTION public.b2b_org_settings(_org_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
      'enabled_modules', jsonb_build_object('coding', true, 'mcq', true, 'interview', true, 'resume', true),
      'quotas', '{}'::jsonb,
      'proctoring_default', CASE WHEN o.type = 'company' THEN 'maximum' ELSE 'standard' END,
      'results_release_default', CASE WHEN o.type = 'company' THEN 'never' ELSE 'manual' END,
      'retention_days', 90,
      'video_enabled', false
    ) || o.settings
  FROM public.organizations o WHERE o.id = _org_id
$$;

-- =============================================
-- Plans: V1 college plans (pooled credits) and the company plan
-- =============================================
ALTER TABLE public.plans
  ADD COLUMN org_type TEXT CHECK (org_type IS NULL OR org_type IN ('college', 'company')),
  ADD COLUMN drives_included INTEGER NOT NULL DEFAULT 0 CHECK (drives_included >= 0),
  ADD COLUMN credits_per_student NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (credits_per_student >= 0),
  ADD COLUMN credits_included NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (credits_included >= 0),
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.plans SET is_active = false WHERE id IN ('basic', 'pro');

INSERT INTO public.plans (id, name, org_type, interviews_per_student, company_packs_enabled, dashboard_enabled,
                          max_students, price_inr_per_student, drives_included, credits_per_student, credits_included) VALUES
  ('college_starter',  'Starter',  'college', 0, true, true, NULL, 399, 1, 4, 0),
  ('college_standard', 'Standard', 'college', 0, true, true, NULL, 499, 2, 5, 0),
  ('college_plus',     'Plus',     'college', 0, true, true, NULL, 599, 3, 5, 0),
  ('company_v1',       'Company',  'company', 0, true, true, NULL, 0,   0, 0, 0);

-- =============================================
-- Audit log (append-only)
-- =============================================
CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID,                  -- no FK: the log must outlive deleted orgs (and cascades)
  actor_id UUID,                -- auth user; NULL = system / cron
  action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
  target_type TEXT,
  target_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org_time ON public.audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_logs_time ON public.audit_logs(created_at DESC);

-- Who is acting: the JWT user, or the actor a service-role function declared with set_config('b2b.actor', …).
CREATE OR REPLACE FUNCTION public.b2b_current_actor()
RETURNS UUID LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(auth.uid(), NULLIF(current_setting('b2b.actor', true), '')::uuid)
$$;

CREATE OR REPLACE FUNCTION public.b2b_audit(
  _org_id UUID, _action TEXT, _target_type TEXT, _target_id TEXT, _meta JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  VALUES (_org_id, public.b2b_current_actor(), _action, _target_type, _target_id, COALESCE(_meta, '{}'::jsonb))
$$;

-- Generic row-change auditing for admin-managed tables.
CREATE OR REPLACE FUNCTION public.b2b_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB := to_jsonb(COALESCE(NEW, OLD));
  v_org UUID := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (r->>'id')::uuid ELSE (r->>'org_id')::uuid END;
  v_changed JSONB := '{}'::jsonb;
  k TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF k NOT IN ('updated_at') AND to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k THEN
        v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(OLD)->k, 'to', to_jsonb(NEW)->k));
      END IF;
    END LOOP;
    IF v_changed = '{}'::jsonb THEN RETURN NEW; END IF;
  END IF;
  PERFORM public.b2b_audit(
    CASE WHEN TG_TABLE_NAME = 'organizations' AND TG_OP = 'DELETE' THEN NULL ELSE v_org END,
    TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, r->>'id',
    CASE TG_OP WHEN 'UPDATE' THEN jsonb_build_object('changed', v_changed)
               WHEN 'DELETE' THEN jsonb_build_object('row', r - 'token_hash')
               ELSE jsonb_build_object('row', r - 'token_hash') END);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_organizations AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
CREATE TRIGGER audit_org_memberships AFTER INSERT OR UPDATE OR DELETE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
CREATE TRIGGER audit_plans AFTER INSERT OR UPDATE OR DELETE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read audit log" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_super_admin() OR (org_id IS NOT NULL AND public.is_org_admin(org_id)));
-- No write policies: rows come only from b2b_audit() / triggers.

-- =============================================
-- Pooled credits
-- =============================================
CREATE TABLE public.org_credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delta NUMERIC(12, 2) NOT NULL CHECK (delta <> 0),
  balance_after NUMERIC(12, 2) NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('grant', 'top_up', 'consume', 'refund', 'adjust', 'expire')),
  feature TEXT,                 -- consume/refund: e.g. practice_interview, practice_coding, resume, candidate_session
  ref_type TEXT,
  ref_id TEXT,
  actor_id UUID,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_ledger_org_time ON public.org_credit_ledger(org_id, created_at DESC);
-- A given thing (e.g. one interview) is charged at most once.
CREATE UNIQUE INDEX idx_credit_ledger_consume_once ON public.org_credit_ledger(org_id, ref_type, ref_id)
  WHERE reason = 'consume' AND ref_id IS NOT NULL;

ALTER TABLE public.org_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read credit ledger" ON public.org_credit_ledger
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.is_org_admin(org_id));

-- Super admin adds or removes credits (grant / top-up / manual adjust). Called from the browser.
CREATE OR REPLACE FUNCTION public.super_adjust_credits(_org_id UUID, _delta NUMERIC, _reason TEXT, _note TEXT DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_balance NUMERIC;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _reason NOT IN ('grant', 'top_up', 'adjust', 'expire') OR _delta = 0 OR abs(_delta) > 1000000 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_CHANGE' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.organizations SET credits_balance = credits_balance + _delta
    WHERE id = _org_id AND credits_balance + _delta >= 0
    RETURNING credits_balance INTO v_balance;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS_OR_ORG_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.org_credit_ledger (org_id, delta, balance_after, reason, actor_id, note)
    VALUES (_org_id, _delta, v_balance, _reason, auth.uid(), _note);
  RETURN v_balance;
END;
$$;

-- Atomic charge for a billable unit (service role: edge functions). Idempotent per (ref_type, ref_id).
CREATE OR REPLACE FUNCTION public.b2b_consume_credits(
  _org_id UUID, _amount NUMERIC, _feature TEXT, _ref_type TEXT, _ref_id TEXT, _actor UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_balance NUMERIC;
  v_status TEXT;
  v_ends TIMESTAMPTZ;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'check_violation'; END IF;
  SELECT status, plan_ends_at INTO v_status, v_ends FROM public.organizations WHERE id = _org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_NOT_FOUND'); END IF;
  IF v_status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_SUSPENDED'); END IF;
  IF v_ends IS NOT NULL AND v_ends <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'PLAN_EXPIRED'); END IF;
  IF _ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_credit_ledger
    WHERE org_id = _org_id AND ref_type = _ref_type AND ref_id = _ref_id AND reason = 'consume'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'balance', (SELECT credits_balance FROM public.organizations WHERE id = _org_id));
  END IF;
  -- Single statement: the row lock makes concurrent charges from a full lab safe.
  UPDATE public.organizations SET credits_balance = credits_balance - _amount
    WHERE id = _org_id AND credits_balance >= _amount
    RETURNING credits_balance INTO v_balance;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_CREDITS',
      'balance', (SELECT credits_balance FROM public.organizations WHERE id = _org_id));
  END IF;
  INSERT INTO public.org_credit_ledger (org_id, delta, balance_after, reason, feature, ref_type, ref_id, actor_id)
    VALUES (_org_id, -_amount, v_balance, 'consume', _feature, _ref_type, _ref_id, _actor);
  RETURN jsonb_build_object('ok', true, 'balance', v_balance);
END;
$$;

-- Give back a charge (e.g. the AI failed before the session started). Only refunds what was consumed.
CREATE OR REPLACE FUNCTION public.b2b_refund_credits(_org_id UUID, _ref_type TEXT, _ref_id TEXT, _actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_charged NUMERIC;
  v_balance NUMERIC;
BEGIN
  SELECT -sum(delta) INTO v_charged FROM public.org_credit_ledger
    WHERE org_id = _org_id AND ref_type = _ref_type AND ref_id = _ref_id AND reason IN ('consume', 'refund');
  IF COALESCE(v_charged, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOTHING_TO_REFUND'); END IF;
  UPDATE public.organizations SET credits_balance = credits_balance + v_charged WHERE id = _org_id
    RETURNING credits_balance INTO v_balance;
  INSERT INTO public.org_credit_ledger (org_id, delta, balance_after, reason, ref_type, ref_id, actor_id)
    VALUES (_org_id, v_charged, v_balance, 'refund', _ref_type, _ref_id, _actor);
  RETURN jsonb_build_object('ok', true, 'refunded', v_charged, 'balance', v_balance);
END;
$$;

-- =============================================
-- Consents: itemised per purpose, withdrawable
-- =============================================
ALTER TABLE public.org_consents
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'account'
    CHECK (purpose IN ('account', 'assessment', 'proctoring_screen', 'proctoring_camera', 'proctoring_audio',
                       'interview_audio', 'recording', 'public_test')),
  ADD COLUMN withdrawn_at TIMESTAMPTZ;
ALTER TABLE public.org_consents DROP CONSTRAINT org_consents_org_id_user_id_consent_version_key;
CREATE UNIQUE INDEX idx_org_consents_purpose ON public.org_consents(org_id, user_id, purpose, consent_version);

-- Service role (edge functions) records consent after showing the exact text.
CREATE OR REPLACE FUNCTION public.b2b_record_consent(
  _org_id UUID, _user_id UUID, _purpose TEXT, _version TEXT, _text TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
  IF coalesce(btrim(_version), '') = '' OR coalesce(btrim(_text), '') = '' THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.org_consents (org_id, user_id, purpose, consent_version, consent_text)
    VALUES (_org_id, _user_id, _purpose, _version, _text)
  ON CONFLICT (org_id, user_id, purpose, consent_version) DO UPDATE SET withdrawn_at = NULL, accepted_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- The subject withdraws their own consent (stop processing; deletion follows the retention job).
CREATE OR REPLACE FUNCTION public.withdraw_consent(_org_id UUID, _purpose TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.org_consents SET withdrawn_at = now()
    WHERE org_id = _org_id AND user_id = auth.uid() AND purpose = _purpose AND withdrawn_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM public.b2b_audit(_org_id, 'consent.withdraw', 'consent', _purpose, '{}'::jsonb); END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_has_consent(_org_id UUID, _user_id UUID, _purpose TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_consents
                 WHERE org_id = _org_id AND user_id = _user_id AND purpose = _purpose AND withdrawn_at IS NULL)
$$;

-- =============================================
-- Invites: staff invites too
-- =============================================
ALTER TABLE public.org_invites
  ADD COLUMN role TEXT NOT NULL DEFAULT 'student'
    CHECK (role IN ('org_admin', 'trainer', 'student', 'recruiter', 'hiring_manager')),
  ALTER COLUMN roll_no DROP NOT NULL;
ALTER TABLE public.org_invites
  ADD CONSTRAINT org_invites_student_roll CHECK (role <> 'student' OR roll_no IS NOT NULL);

CREATE TRIGGER audit_org_invites AFTER INSERT OR UPDATE OF status, role ON public.org_invites
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

-- Super admin (from the browser) or an org admin (service role, actor passed) invites staff.
-- Returns the invite id; the caller generated the token and stores only its hash.
CREATE OR REPLACE FUNCTION public.b2b_invite_staff(
  _actor UUID, _org_id UUID, _email TEXT, _full_name TEXT, _role TEXT, _token_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type TEXT;
  v_email TEXT := lower(btrim(_email));
  v_id UUID;
BEGIN
  -- COALESCE: a non-member's role is NULL, and NOT (false OR NULL) would let them through.
  IF NOT (public.actor_is_super_admin(_actor) OR COALESCE(public.actor_org_role(_actor, _org_id) = 'org_admin', false)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only a super admin can create the first org admin; org admins can add any staff role.
  SELECT type INTO v_type FROM public.organizations WHERE id = _org_id;
  IF v_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_NOT_FOUND'); END IF;
  IF _role = 'student' OR NOT public.b2b_role_fits_org(_role, v_type) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ROLE_NOT_ALLOWED');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_EMAIL'); END IF;
  IF EXISTS (SELECT 1 FROM public.org_memberships WHERE org_id = _org_id AND lower(email) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_MEMBER');
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  -- Re-inviting the same email replaces the live invite (new link).
  UPDATE public.org_invites SET status = 'revoked' WHERE org_id = _org_id AND email = v_email AND status = 'pending';
  INSERT INTO public.org_invites (org_id, full_name, email, role, token_hash, invited_by, expires_at)
    VALUES (_org_id, COALESCE(NULLIF(btrim(_full_name), ''), v_email), v_email, _role, _token_hash, _actor,
            now() + interval '14 days')
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'invite_id', v_id);
END;
$$;

-- Accepting an invite: students as before (consent required); staff invites need the invited email.
CREATE OR REPLACE FUNCTION public.b2b_accept_invite(
  _token_hash TEXT, _user_id UUID, _consent_version TEXT, _consent_text TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv public.org_invites;
  v_existing TEXT;
  v_user_email TEXT;
BEGIN
  SELECT * INTO inv FROM public.org_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID'); END IF;
  IF inv.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'reason', 'REVOKED'); END IF;
  IF inv.status = 'accepted' THEN
    IF inv.accepted_by = _user_id THEN RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id, 'already', true); END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;
  IF inv.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED'); END IF;
  IF inv.role = 'student' AND (coalesce(btrim(_consent_version), '') = '' OR coalesce(btrim(_consent_text), '') = '') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CONSENT_REQUIRED');
  END IF;
  -- A staff link only works for the invited address (staff powers must not be forwardable).
  IF inv.role <> 'student' THEN
    SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = _user_id;
    IF v_user_email IS DISTINCT FROM inv.email THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_ACCOUNT', 'email', inv.email);
    END IF;
  END IF;
  PERFORM set_config('b2b.actor', _user_id::text, true);

  SELECT role INTO v_existing FROM public.org_memberships WHERE org_id = inv.org_id AND user_id = _user_id;
  IF inv.role = 'student' THEN
    IF v_existing IS NOT NULL AND v_existing <> 'student' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'STAFF_ACCOUNT');
    END IF;
    IF v_existing IS NULL THEN
      BEGIN
        INSERT INTO public.org_memberships (org_id, user_id, role, batch_id, full_name, email, roll_no)
          VALUES (inv.org_id, _user_id, 'student', inv.batch_id, inv.full_name, inv.email, inv.roll_no);
      EXCEPTION
        WHEN check_violation THEN RETURN jsonb_build_object('ok', false, 'reason', 'STUDENT_LIMIT_REACHED');
        WHEN unique_violation THEN RETURN jsonb_build_object('ok', false, 'reason', 'ROLL_NO_TAKEN');
      END;
    END IF;
    INSERT INTO public.org_consents (org_id, user_id, purpose, consent_version, consent_text, invite_id)
      VALUES (inv.org_id, _user_id, 'account', _consent_version, _consent_text, inv.id)
      ON CONFLICT (org_id, user_id, purpose, consent_version) DO NOTHING;
  ELSE
    IF v_existing = 'student' THEN RETURN jsonb_build_object('ok', false, 'reason', 'STUDENT_ACCOUNT'); END IF;
    INSERT INTO public.org_memberships (org_id, user_id, role, full_name, email)
      VALUES (inv.org_id, _user_id, inv.role, inv.full_name, inv.email)
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;

  UPDATE public.org_invites SET status = 'accepted', accepted_by = _user_id, accepted_at = now() WHERE id = inv.id;
  RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id, 'role', inv.role);
END;
$$;

-- Super admin: attach an existing account directly (kept from the pilot, now text-typed).
CREATE FUNCTION public.super_add_org_member(
  _org_id UUID, _email TEXT, _role TEXT, _full_name TEXT DEFAULT NULL
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

-- =============================================
-- Grants (Supabase grants EXECUTE to anon/authenticated by default: lock each down)
-- =============================================
REVOKE EXECUTE ON FUNCTION
  public.org_role_of(UUID), public.is_org_editor(UUID), public.b2b_org_settings(UUID),
  public.super_adjust_credits(UUID, NUMERIC, TEXT, TEXT), public.withdraw_consent(UUID, TEXT),
  public.super_add_org_member(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.org_role_of(UUID), public.is_org_editor(UUID), public.b2b_org_settings(UUID),
  public.super_adjust_credits(UUID, NUMERIC, TEXT, TEXT), public.withdraw_consent(UUID, TEXT),
  public.super_add_org_member(UUID, TEXT, TEXT, TEXT)
TO authenticated;

REVOKE EXECUTE ON FUNCTION
  public.actor_org_role(UUID, UUID), public.actor_is_super_admin(UUID), public.actor_is_org_editor(UUID, UUID),
  public.b2b_audit(UUID, TEXT, TEXT, TEXT, JSONB), public.b2b_consume_credits(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID),
  public.b2b_refund_credits(UUID, TEXT, TEXT, UUID), public.b2b_record_consent(UUID, UUID, TEXT, TEXT, TEXT),
  public.b2b_has_consent(UUID, UUID, TEXT), public.b2b_invite_staff(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  public.b2b_accept_invite(TEXT, UUID, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.actor_org_role(UUID, UUID), public.actor_is_super_admin(UUID), public.actor_is_org_editor(UUID, UUID),
  public.b2b_audit(UUID, TEXT, TEXT, TEXT, JSONB), public.b2b_consume_credits(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID),
  public.b2b_refund_credits(UUID, TEXT, TEXT, UUID), public.b2b_record_consent(UUID, UUID, TEXT, TEXT, TEXT),
  public.b2b_has_consent(UUID, UUID, TEXT), public.b2b_invite_staff(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  public.b2b_accept_invite(TEXT, UUID, TEXT, TEXT)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.b2b_audit_row(), public.org_memberships_role_fits(),
  public.organizations_type_locked(), public.b2b_current_actor(), public.b2b_role_fits_org(TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
