-- Tenant guards. (1) Interview modules. drives.interview_module_id and job_roles.interview_module_id are plain foreign
-- keys (a module may be a global library template, org_id NULL), so the composite (id, org_id) keys that protect
-- assessments, students and candidates don't cover them: an org editor writing the table directly could point a
-- drive or role at another organisation's private module, and its students or candidates would then run it.
-- A module is usable by an org only when it is global or belongs to that org.
CREATE OR REPLACE FUNCTION public.b2b_module_belongs_to_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.interview_module_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interview_modules m
    WHERE m.id = NEW.interview_module_id AND (m.org_id IS NULL OR m.org_id = NEW.org_id)
  ) THEN
    RAISE EXCEPTION 'MODULE_NOT_IN_ORG' USING ERRCODE = 'check_violation',
      HINT = 'Use one of your organisation''s interview modules or a library template.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_module_belongs_to_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS drives_module_in_org ON public.drives;
CREATE TRIGGER drives_module_in_org BEFORE INSERT OR UPDATE OF interview_module_id, org_id ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.b2b_module_belongs_to_org();

DROP TRIGGER IF EXISTS job_roles_module_in_org ON public.job_roles;
CREATE TRIGGER job_roles_module_in_org BEFORE INSERT OR UPDATE OF interview_module_id, org_id ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.b2b_module_belongs_to_org();

-- Memberships: an org admin may change a member's role, but not who the member is or which org it's in. The UPDATE
-- policy only checks that the caller administers the (new) org, so without this an admin could rewrite a row's
-- user_id and attach any account to their organisation. Rows are created only by super admins and the invite
-- functions (service role); nothing legitimate moves a membership to another user or org.
-- Same idiom as students_user_id_guard: only direct writes from a signed-in user are checked.
CREATE OR REPLACE FUNCTION public.b2b_membership_identity_locked()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.org_id IS DISTINCT FROM OLD.org_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'MEMBERSHIP_IDENTITY_LOCKED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_membership_identity_locked() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS org_memberships_identity_locked ON public.org_memberships;
CREATE TRIGGER org_memberships_identity_locked BEFORE UPDATE OF user_id, org_id ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.b2b_membership_identity_locked();
