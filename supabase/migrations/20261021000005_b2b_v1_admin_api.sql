-- B2B V1 — super admin write paths (called by the b2b-admin edge function with the service role).
-- Each function re-checks that the actor is a super admin and records the actor for the audit triggers.

CREATE OR REPLACE FUNCTION public.super_create_org(_actor UUID, _org JSONB, _initial_credits NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id UUID;
  v_plan public.plans;
  v_credits NUMERIC;
  v_balance NUMERIC;
BEGIN
  IF NOT public.actor_is_super_admin(_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);

  SELECT * INTO v_plan FROM public.plans WHERE id = _org->>'planId';
  IF NOT FOUND OR NOT v_plan.is_active THEN RETURN jsonb_build_object('ok', false, 'reason', 'PLAN_NOT_FOUND'); END IF;
  IF v_plan.org_type IS NOT NULL AND v_plan.org_type <> _org->>'type' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PLAN_ORG_TYPE_MISMATCH');
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = _org->>'slug') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SLUG_TAKEN');
  END IF;

  INSERT INTO public.organizations (name, slug, type, plan_id, plan_starts_at, plan_ends_at, seat_limit, contact_name,
                                    contact_email, contact_phone, address, logo_url, settings, created_by)
  VALUES (_org->>'name', _org->>'slug', _org->>'type', v_plan.id,
          COALESCE((_org->>'validFrom')::timestamptz, now()), (_org->>'validTo')::timestamptz,
          (_org->>'seatLimit')::integer, _org->>'contactName', _org->>'contactEmail', _org->>'contactPhone',
          _org->>'address', _org->>'logoUrl', COALESCE(_org->'settings', '{}'::jsonb), _actor)
  RETURNING id INTO v_id;

  v_credits := COALESCE(_initial_credits,
                        CASE WHEN (_org->>'seatLimit') IS NOT NULL
                             THEN (_org->>'seatLimit')::numeric * v_plan.credits_per_student
                             ELSE v_plan.credits_included END, 0);
  IF v_credits > 0 THEN
    UPDATE public.organizations SET credits_balance = v_credits WHERE id = v_id RETURNING credits_balance INTO v_balance;
    INSERT INTO public.org_credit_ledger (org_id, delta, balance_after, reason, actor_id, note)
      VALUES (v_id, v_credits, v_balance, 'grant', _actor, 'Opening pool for plan ' || v_plan.id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'org_id', v_id, 'credits', v_credits);
END;
$$;

-- Patch: only the keys present are changed.
CREATE OR REPLACE FUNCTION public.super_update_org(_actor UUID, _org_id UUID, _patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.actor_is_super_admin(_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.organizations o SET
    name          = CASE WHEN _patch ? 'name' THEN _patch->>'name' ELSE o.name END,
    status        = CASE WHEN _patch ? 'status' THEN _patch->>'status' ELSE o.status END,
    plan_id       = CASE WHEN _patch ? 'planId' THEN _patch->>'planId' ELSE o.plan_id END,
    plan_starts_at = CASE WHEN _patch ? 'validFrom' THEN (_patch->>'validFrom')::timestamptz ELSE o.plan_starts_at END,
    plan_ends_at  = CASE WHEN _patch ? 'validTo' THEN (_patch->>'validTo')::timestamptz ELSE o.plan_ends_at END,
    seat_limit    = CASE WHEN _patch ? 'seatLimit' THEN (_patch->>'seatLimit')::integer ELSE o.seat_limit END,
    contact_name  = CASE WHEN _patch ? 'contactName' THEN _patch->>'contactName' ELSE o.contact_name END,
    contact_email = CASE WHEN _patch ? 'contactEmail' THEN _patch->>'contactEmail' ELSE o.contact_email END,
    contact_phone = CASE WHEN _patch ? 'contactPhone' THEN _patch->>'contactPhone' ELSE o.contact_phone END,
    address       = CASE WHEN _patch ? 'address' THEN _patch->>'address' ELSE o.address END,
    logo_url      = CASE WHEN _patch ? 'logoUrl' THEN _patch->>'logoUrl' ELSE o.logo_url END,
    settings      = CASE WHEN _patch ? 'settings' THEN o.settings || (_patch->'settings') ELSE o.settings END
  WHERE o.id = _org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- The invite page needs the invited role (staff invites skip the student consent step).
CREATE OR REPLACE FUNCTION public.b2b_invite_preview(_token_hash TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'invite_id', i.id,
    'status', CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status::text END,
    'role', i.role,
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

REVOKE EXECUTE ON FUNCTION public.super_create_org(UUID, JSONB, NUMERIC), public.super_update_org(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_create_org(UUID, JSONB, NUMERIC), public.super_update_org(UUID, UUID, JSONB)
  TO service_role;
