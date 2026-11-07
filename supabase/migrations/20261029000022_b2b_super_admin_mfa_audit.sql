-- R3.5 super admin hardening.
--  1. MFA: super-admin powers need a login verified with a second factor (JWT aal = 'aal2'). TOTP MFA is free and
--     on for every Supabase project (supabase.com/docs/guides/auth/auth-mfa/totp).
--     * is_super_admin() (every RLS policy and guarded function) requires aal2 whenever the request carries JWT
--       claims (always true through PostgREST). Without claims (service-role functions, cron, tests) nothing changes.
--     * b2b_is_admin_role() tells the admin screens "you are an admin, now verify MFA" without granting anything.
--     * b2b_request_gate() is the single per-request check for B2B edge functions: student sessions (R1.6) and
--       super admins without MFA (MFA_REQUIRED). Edge functions call it from requireUser.
--  2. Audit: before/after rows already cover organizations, memberships, plans, invites, students, drives,
--     assessments, roles, candidates, reviews and share links. Added here: user_roles (who granted admin),
--     b2b_pricing (AI cost rates) and interview_modules.
-- Rollback: restore is_super_admin() from 20260923000001_b2b_tenancy.sql; DROP FUNCTION public.b2b_jwt_aal(),
-- public.b2b_is_admin_role(), public.b2b_request_gate(uuid, text, text); DROP TRIGGER audit_user_roles ON
-- public.user_roles, audit_b2b_pricing ON public.b2b_pricing, audit_interview_modules ON public.interview_modules.

CREATE OR REPLACE FUNCTION public.b2b_jwt_aal()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'aal',
                  NULLIF(current_setting('request.jwt.claim.aal', true), ''))
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
     -- A signed-in request must be MFA-verified to act as super admin (R3.5).
     AND (public.b2b_jwt_aal() IS NULL OR public.b2b_jwt_aal() = 'aal2')
$$;

-- "Am I an admin?" for the MFA screen only; grants nothing.
CREATE OR REPLACE FUNCTION public.b2b_is_admin_role()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
$$;
REVOKE ALL ON FUNCTION public.b2b_is_admin_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_is_admin_role() TO authenticated;

-- Per-request gate for B2B edge functions (service role): { ok, reason? }.
CREATE OR REPLACE FUNCTION public.b2b_request_gate(_user_id UUID, _auth_session_id TEXT, _aal TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
     AND COALESCE(_aal, '') <> 'aal2' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MFA_REQUIRED');
  END IF;
  RETURN public.b2b_session_touch(_user_id, _auth_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_request_gate(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_request_gate(UUID, TEXT, TEXT) TO service_role;

DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
DROP TRIGGER IF EXISTS audit_b2b_pricing ON public.b2b_pricing;
CREATE TRIGGER audit_b2b_pricing AFTER INSERT OR UPDATE OR DELETE ON public.b2b_pricing
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
DROP TRIGGER IF EXISTS audit_interview_modules ON public.interview_modules;
CREATE TRIGGER audit_interview_modules AFTER INSERT OR UPDATE OR DELETE ON public.interview_modules
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
