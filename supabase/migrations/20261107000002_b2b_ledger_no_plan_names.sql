-- B14 + owner rule (2026-11-07): no prices or plan names in college/company portals. Pricing is set per
-- college (it can include distributor or mediator commissions), so the plan tier stays super-admin only.
-- The opening credit grant's ledger note named the plan ("Opening pool for plan college_starter") and staff read
-- the ledger. New orgs get a neutral note; existing notes are rewritten.

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
      VALUES (v_id, v_credits, v_balance, 'grant', _actor, 'Opening credits');
  END IF;
  RETURN jsonb_build_object('ok', true, 'org_id', v_id, 'credits', v_credits);
END;
$$;

UPDATE public.org_credit_ledger SET note = 'Opening credits' WHERE note LIKE 'Opening pool for plan %';
