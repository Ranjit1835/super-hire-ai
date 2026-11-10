-- Staff invites show up after sign-in (owner, 2026-11-10): a TPO invited to a college saw nothing when they signed
-- in, because an invite could only be accepted from its emailed link, and email isn't set up yet.
-- * b2b_my_staff_invites(): the signed-in user's pending, unexpired staff invites (not student invites, which need the
--   consent screen on the invite link) to active organisations. Only once the account's email is verified, so nobody
--   can claim an invite by signing up with someone else's address.
-- * b2b_accept_my_invite(id): accepts one of those through b2b_accept_invite, which re-checks everything (email match,
--   expiry, revoked, student account).
-- Rollback: DROP FUNCTION public.b2b_my_staff_invites(), public.b2b_accept_my_invite(UUID).

CREATE OR REPLACE FUNCTION public.b2b_my_staff_invites()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'role', i.role, 'expires_at', i.expires_at,
           'org', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type)) ORDER BY i.created_at DESC), '[]'::jsonb)
  FROM public.org_invites i
  JOIN public.organizations o ON o.id = i.org_id AND o.deactivated_at IS NULL
  JOIN auth.users u ON u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND lower(u.email) = i.email
  WHERE i.status = 'pending' AND i.role <> 'student' AND i.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION public.b2b_accept_my_invite(_invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'SIGNED_OUT'); END IF;
  SELECT i.token_hash INTO v_hash
  FROM public.org_invites i
  JOIN auth.users u ON u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND lower(u.email) = i.email
  WHERE i.id = _invite_id AND i.role <> 'student';
  IF v_hash IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID'); END IF;
  RETURN public.b2b_accept_invite(v_hash, auth.uid(), NULL, NULL);
END $$;

REVOKE EXECUTE ON FUNCTION public.b2b_my_staff_invites() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.b2b_accept_my_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_my_staff_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_accept_my_invite(UUID) TO authenticated;
