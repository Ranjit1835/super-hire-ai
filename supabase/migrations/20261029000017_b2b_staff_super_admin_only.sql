-- R3.3 / D7: full access belongs to super admins. Org admins (TPOs, company admins) manage their students, not their
-- staff: they can't invite staff of any role, change anyone's role, or remove staff. They keep everything about
-- students: add, invite (give access), edit, deactivate.
--  * b2b_invite_staff: super admins only (was: super admins and the org's admins).
--  * org_memberships UPDATE / DELETE: an org admin may touch only student rows, and an update must leave the row a
--    student (no promotion). Super admins unchanged. (user_id / org_id stay immutable: org_memberships_immutable_keys.)
-- Rollback: restore b2b_invite_staff from 20261021000001_b2b_v1_tenancy.sql and the two policies from
-- 20260923000001_b2b_tenancy.sql.

CREATE OR REPLACE FUNCTION public.b2b_invite_staff(
  _actor UUID, _org_id UUID, _email TEXT, _full_name TEXT, _role TEXT, _token_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type TEXT;
  v_email TEXT := lower(btrim(_email));
  v_id UUID;
BEGIN
  IF NOT public.actor_is_super_admin(_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
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
  UPDATE public.org_invites SET status = 'revoked' WHERE org_id = _org_id AND email = v_email AND status = 'pending';
  INSERT INTO public.org_invites (org_id, full_name, email, role, token_hash, invited_by, expires_at)
    VALUES (_org_id, COALESCE(NULLIF(btrim(_full_name), ''), v_email), v_email, _role, _token_hash, _actor,
            now() + interval '14 days')
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'invite_id', v_id);
END;
$$;

DROP POLICY IF EXISTS "Org admin updates memberships" ON public.org_memberships;
CREATE POLICY "Org admin updates memberships" ON public.org_memberships
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (public.is_org_admin(org_id) AND role = 'student'))
  WITH CHECK (public.is_super_admin() OR (public.is_org_admin(org_id) AND role = 'student'));

DROP POLICY IF EXISTS "Org admin deletes memberships" ON public.org_memberships;
CREATE POLICY "Org admin deletes memberships" ON public.org_memberships
  FOR DELETE TO authenticated USING (public.is_super_admin() OR (public.is_org_admin(org_id) AND role = 'student'));
