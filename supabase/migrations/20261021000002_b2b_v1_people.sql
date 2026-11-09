-- B2B V1 — people: college students (rows exist before they activate) and company candidates
-- (token access, no password account; their browser session is a Supabase anonymous user linked here).

-- =============================================
-- Students
-- =============================================
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,     -- set when the student activates
  batch_id UUID,
  roll_no TEXT NOT NULL CHECK (length(btrim(roll_no)) BETWEEN 1 AND 60),
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 30),
  department TEXT CHECK (department IS NULL OR length(department) <= 120),
  batch_year INTEGER CHECK (batch_year IS NULL OR batch_year BETWEEN 2000 AND 2100),  -- graduation year
  section TEXT CHECK (section IS NULL OR length(section) <= 40),
  cgpa NUMERIC(4, 2) CHECK (cgpa IS NULL OR cgpa BETWEEN 0 AND 10),
  active_backlogs INTEGER CHECK (active_backlogs IS NULL OR active_backlogs >= 0),
  tenth_pct NUMERIC(5, 2) CHECK (tenth_pct IS NULL OR tenth_pct BETWEEN 0 AND 100),
  twelfth_pct NUMERIC(5, 2) CHECK (twelfth_pct IS NULL OR twelfth_pct BETWEEN 0 AND 100),
  dob DATE,
  -- held_minor: under 18 at import; not activated in V1 (Decisions log 2026-10-20).
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK (status IN ('imported', 'invited', 'active', 'deactivated', 'held_minor')),
  custom JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (batch_id, org_id) REFERENCES public.batches(id, org_id) ON DELETE SET NULL (batch_id)
);
CREATE UNIQUE INDEX idx_students_roll ON public.students(org_id, lower(roll_no));
CREATE UNIQUE INDEX idx_students_email ON public.students(org_id, email);
CREATE UNIQUE INDEX idx_students_user ON public.students(org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_students_filters ON public.students(org_id, department, batch_year, section);
CREATE INDEX idx_students_user_any ON public.students(user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER audit_students AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

-- Students exist only in college-type orgs.
CREATE OR REPLACE FUNCTION public.b2b_require_org_type()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_type TEXT;
BEGIN
  SELECT type INTO v_type FROM public.organizations WHERE id = NEW.org_id;
  IF (TG_ARGV[0] = 'college' AND v_type = 'company') OR (TG_ARGV[0] = 'company' AND v_type <> 'company') THEN
    RAISE EXCEPTION 'WRONG_ORG_TYPE: % rows need a % org', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER students_college_only BEFORE INSERT OR UPDATE OF org_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.b2b_require_org_type('college');

-- Under 18 on a given day (DOB check at import).
CREATE OR REPLACE FUNCTION public.b2b_is_minor(_dob DATE, _on DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _dob IS NOT NULL AND _dob > (_on - interval '18 years')::date
$$;

CREATE OR REPLACE FUNCTION public.my_student_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.students WHERE user_id = auth.uid()
$$;

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read students" ON public.students FOR SELECT TO authenticated USING (
  public.is_super_admin() OR user_id = auth.uid()
  OR (public.is_org_staff(org_id) AND public.org_role_of(org_id) <> 'hiring_manager')
);
-- Manual add / edit / remove by the TPO admin; bulk import goes through a service-role function.
CREATE POLICY "Org admin inserts students" ON public.students FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));
CREATE POLICY "Org admin updates students" ON public.students FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));
CREATE POLICY "Org admin deletes students" ON public.students FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id));

-- user_id is set only by invite acceptance (service role); an admin can't attach an account.
CREATE OR REPLACE FUNCTION public.students_user_id_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.user_id IS DISTINCT FROM
     (CASE WHEN TG_OP = 'UPDATE' THEN OLD.user_id ELSE NULL END) THEN
    RAISE EXCEPTION 'students.user_id is set by invite acceptance only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER students_user_id_guard BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_user_id_guard();

-- =============================================
-- Candidates (company orgs)
-- =============================================
CREATE TABLE public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 30),
  resume_path TEXT,             -- storage path (private bucket), if a resume was uploaded
  resume_text TEXT CHECK (resume_text IS NULL OR length(resume_text) <= 60000),
  source TEXT NOT NULL DEFAULT 'invite' CHECK (source IN ('invite', 'csv', 'apply_link', 'manual')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,     -- session user linked on first token use
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, email)
);
CREATE INDEX idx_candidates_user ON public.candidates(user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER update_candidates_updated_at BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER candidates_company_only BEFORE INSERT OR UPDATE OF org_id ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.b2b_require_org_type('company');
CREATE TRIGGER audit_candidates AFTER INSERT OR DELETE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

-- Candidate policies reference job roles, so they are created in the programs migration.
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

-- =============================================
-- Invites ↔ student records
-- =============================================
ALTER TABLE public.org_invites
  ADD COLUMN student_id UUID REFERENCES public.students(id) ON DELETE CASCADE;
CREATE INDEX idx_org_invites_student ON public.org_invites(student_id) WHERE student_id IS NOT NULL;

-- Same as 20261021000001, plus: a student invite linked to a student record activates that record.
CREATE OR REPLACE FUNCTION public.b2b_accept_invite(
  _token_hash TEXT, _user_id UUID, _consent_version TEXT, _consent_text TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv public.org_invites;
  v_existing TEXT;
  v_user_email TEXT;
  v_status TEXT;
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
  IF inv.role <> 'student' THEN
    SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = _user_id;
    IF v_user_email IS DISTINCT FROM inv.email THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_ACCOUNT', 'email', inv.email);
    END IF;
  END IF;
  IF inv.student_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.students WHERE id = inv.student_id;
    IF v_status IN ('deactivated', 'held_minor') THEN
      RETURN jsonb_build_object('ok', false, 'reason', upper(v_status));
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
    IF inv.student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _user_id, status = 'active' WHERE id = inv.student_id;
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

REVOKE EXECUTE ON FUNCTION public.my_student_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_student_ids() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.b2b_require_org_type(), public.students_user_id_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_is_minor(DATE, DATE) TO authenticated, service_role;
