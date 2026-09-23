-- B2B bulk onboarding: CSV invites + student consent.
-- Raw invite tokens never touch the database: the edge function generates a
-- 256-bit token, stores only its SHA-256 hex, and emails / returns the link once.
-- All state changes go through the service-role-only functions below so each
-- import / acceptance is atomic and re-checks authorization itself.

CREATE TYPE public.org_invite_status AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE public.org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id UUID,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  roll_no TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status public.org_invite_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, org_id) REFERENCES public.batches(id, org_id) ON DELETE SET NULL (batch_id)
);

-- One live invite per email / roll number per org (revoked ones don't block re-inviting).
CREATE UNIQUE INDEX idx_org_invites_email ON public.org_invites(org_id, email) WHERE status <> 'revoked';
CREATE UNIQUE INDEX idx_org_invites_roll ON public.org_invites(org_id, lower(roll_no)) WHERE status <> 'revoked';
CREATE INDEX idx_org_invites_org_status ON public.org_invites(org_id, status);

CREATE TRIGGER update_org_invites_updated_at
  BEFORE UPDATE ON public.org_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.org_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL, -- exact wording shown, for audit
  invite_id UUID REFERENCES public.org_invites(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, consent_version)
);

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_consents ENABLE ROW LEVEL SECURITY;

-- Staff see their org's invites (token_hash is a one-way hash of a 256-bit token).
-- No direct writes: everything goes through the functions below.
CREATE POLICY "Staff read invites" ON public.org_invites
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.is_org_staff(org_id));

CREATE POLICY "Read consents" ON public.org_consents
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR user_id = auth.uid() OR public.is_org_staff(org_id)
  );

-- =============================================
-- Authorization helper for service-role callers (no auth.uid() there)
-- =============================================
CREATE OR REPLACE FUNCTION public.actor_is_org_admin(_actor UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin')
      OR EXISTS (SELECT 1 FROM public.org_memberships
                 WHERE user_id = _actor AND org_id = _org_id AND role = 'org_admin')
$$;

-- =============================================
-- Import
-- _rows: [{ "row": 2, "full_name", "email", "roll_no", "department", "batch", "token_hash" }]
-- Rows are expected to be pre-validated (shared validator in _shared/invite-csv.ts);
-- this function owns duplicate detection, batch creation and the capacity check.
-- Returns [{ "row", "status": "invited" | "skipped" | "error", "reason", "invite_id" }]
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_import_invites(_actor UUID, _org_id UUID, _rows JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB;
  v_results JSONB := '[]'::jsonb;
  v_email TEXT;
  v_roll TEXT;
  v_batch_name TEXT;
  v_batch_id UUID;
  v_invite_id UUID;
  v_max INTEGER;
  v_taken INTEGER;
  v_seen_emails TEXT[] := '{}';
  v_seen_rolls TEXT[] := '{}';
BEGIN
  IF NOT public.actor_is_org_admin(_actor, _org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) > 2000 THEN
    RAISE EXCEPTION 'INVALID_ROWS: expected an array of at most 2000 rows';
  END IF;

  -- Same lock as enforce_max_students: capacity is checked against a stable count.
  PERFORM pg_advisory_xact_lock(hashtextextended('org_students:' || _org_id::text, 0));
  SELECT p.max_students INTO v_max
    FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id WHERE o.id = _org_id;
  SELECT (SELECT count(*) FROM public.org_memberships WHERE org_id = _org_id AND role = 'student')
       + (SELECT count(*) FROM public.org_invites WHERE org_id = _org_id AND status = 'pending' AND expires_at > now())
    INTO v_taken;

  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_email := lower(btrim(r->>'email'));
    v_roll := btrim(r->>'roll_no');

    IF v_email = ANY (v_seen_emails) THEN
      v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'skipped', 'reason', 'Duplicate email in this file');
      CONTINUE;
    END IF;
    IF lower(v_roll) = ANY (v_seen_rolls) THEN
      v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'skipped', 'reason', 'Duplicate roll number in this file');
      CONTINUE;
    END IF;
    v_seen_emails := v_seen_emails || v_email;
    v_seen_rolls := v_seen_rolls || lower(v_roll);

    IF EXISTS (SELECT 1 FROM public.org_memberships m
               WHERE m.org_id = _org_id AND (lower(m.email) = v_email OR lower(m.roll_no) = lower(v_roll))) THEN
      v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'skipped', 'reason', 'Already a member');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.org_invites i
               WHERE i.org_id = _org_id AND i.status <> 'revoked'
                 AND (i.email = v_email OR lower(i.roll_no) = lower(v_roll))) THEN
      v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'skipped', 'reason', 'Already invited');
      CONTINUE;
    END IF;
    IF v_max IS NOT NULL AND v_taken >= v_max THEN
      v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'error',
        'reason', format('Plan limit reached (%s students incl. pending invites)', v_max));
      CONTINUE;
    END IF;

    v_batch_name := btrim(r->>'batch');
    SELECT id INTO v_batch_id FROM public.batches WHERE org_id = _org_id AND lower(name) = lower(v_batch_name);
    IF v_batch_id IS NULL THEN
      INSERT INTO public.batches (org_id, name, department)
        VALUES (_org_id, v_batch_name, NULLIF(btrim(r->>'department'), ''))
        RETURNING id INTO v_batch_id;
    END IF;

    INSERT INTO public.org_invites (org_id, batch_id, full_name, email, roll_no, token_hash, invited_by)
      VALUES (_org_id, v_batch_id, btrim(r->>'full_name'), v_email, v_roll, r->>'token_hash', _actor)
      RETURNING id INTO v_invite_id;
    v_taken := v_taken + 1;
    v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'invited', 'invite_id', v_invite_id);
  END LOOP;

  RETURN v_results;
END;
$$;

-- =============================================
-- Invite lifecycle
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_invite_preview(_token_hash TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'invite_id', i.id,
    'status', CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status::text END,
    'full_name', i.full_name,
    'email', i.email,
    'roll_no', i.roll_no,
    'batch', b.name,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type, 'logo_url', o.logo_url, 'is_demo', o.is_demo)
  )
  FROM public.org_invites i
  JOIN public.organizations o ON o.id = i.org_id
  LEFT JOIN public.batches b ON b.id = i.batch_id
  WHERE i.token_hash = _token_hash
$$;

CREATE OR REPLACE FUNCTION public.b2b_accept_invite(
  _token_hash TEXT, _user_id UUID, _consent_version TEXT, _consent_text TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv public.org_invites;
  v_existing public.org_member_role;
BEGIN
  IF coalesce(btrim(_consent_version), '') = '' OR coalesce(btrim(_consent_text), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CONSENT_REQUIRED');
  END IF;

  SELECT * INTO inv FROM public.org_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID');
  END IF;
  IF inv.status = 'revoked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REVOKED');
  END IF;
  IF inv.status = 'accepted' THEN
    IF inv.accepted_by = _user_id THEN
      RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id, 'already', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;
  IF inv.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  END IF;

  SELECT role INTO v_existing FROM public.org_memberships WHERE org_id = inv.org_id AND user_id = _user_id;
  IF v_existing IS NOT NULL AND v_existing <> 'student' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'STAFF_ACCOUNT');
  END IF;

  IF v_existing IS NULL THEN
    BEGIN
      INSERT INTO public.org_memberships (org_id, user_id, role, batch_id, full_name, email, roll_no)
        VALUES (inv.org_id, _user_id, 'student', inv.batch_id, inv.full_name, inv.email, inv.roll_no);
    EXCEPTION
      WHEN check_violation THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'STUDENT_LIMIT_REACHED');
      WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ROLL_NO_TAKEN');
    END;
  END IF;

  INSERT INTO public.org_consents (org_id, user_id, consent_version, consent_text, invite_id)
    VALUES (inv.org_id, _user_id, _consent_version, _consent_text, inv.id)
    ON CONFLICT (org_id, user_id, consent_version) DO NOTHING;

  UPDATE public.org_invites
    SET status = 'accepted', accepted_by = _user_id, accepted_at = now()
    WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id);
END;
$$;

-- New link for a pending invite (resend / WhatsApp). Old link stops working.
CREATE OR REPLACE FUNCTION public.b2b_rotate_invite(_actor UUID, _invite_id UUID, _new_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv public.org_invites;
BEGIN
  SELECT * INTO inv FROM public.org_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_is_org_admin(_actor, inv.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF inv.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', upper(inv.status::text));
  END IF;
  UPDATE public.org_invites
    SET token_hash = _new_token_hash, expires_at = now() + interval '30 days', email_error = NULL
    WHERE id = _invite_id;
  RETURN jsonb_build_object('ok', true, 'email', inv.email, 'full_name', inv.full_name, 'org_id', inv.org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_revoke_invite(_actor UUID, _invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv public.org_invites;
BEGIN
  SELECT * INTO inv FROM public.org_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_is_org_admin(_actor, inv.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF inv.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', upper(inv.status::text));
  END IF;
  UPDATE public.org_invites SET status = 'revoked' WHERE id = _invite_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_mark_invite_email(_invite_ids UUID[], _error TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.org_invites
    SET email_sent_at = CASE WHEN _error IS NULL THEN now() ELSE email_sent_at END,
        email_error = _error
    WHERE id = ANY (_invite_ids)
$$;

-- Lets the invite page offer "create account" vs "sign in" for the invited email.
CREATE OR REPLACE FUNCTION public.b2b_email_has_account(_email TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(_email)))
$$;

REVOKE EXECUTE ON FUNCTION
  public.b2b_email_has_account(TEXT),
  public.actor_is_org_admin(UUID, UUID),
  public.b2b_import_invites(UUID, UUID, JSONB),
  public.b2b_invite_preview(TEXT),
  public.b2b_accept_invite(TEXT, UUID, TEXT, TEXT),
  public.b2b_rotate_invite(UUID, UUID, TEXT),
  public.b2b_revoke_invite(UUID, UUID),
  public.b2b_mark_invite_email(UUID[], TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_email_has_account(TEXT),
  public.actor_is_org_admin(UUID, UUID),
  public.b2b_import_invites(UUID, UUID, JSONB),
  public.b2b_invite_preview(TEXT),
  public.b2b_accept_invite(TEXT, UUID, TEXT, TEXT),
  public.b2b_rotate_invite(UUID, UUID, TEXT),
  public.b2b_revoke_invite(UUID, UUID),
  public.b2b_mark_invite_email(UUID[], TEXT)
TO service_role;
