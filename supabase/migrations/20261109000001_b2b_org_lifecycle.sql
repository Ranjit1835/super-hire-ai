-- Organisation lifecycle and drive deletion (owner decisions 2026-11-09).
--
-- * Deactivate an organisation: every member (staff and students) loses access at once, nothing is deleted, and it
--   can be undone. Both access choke points refuse a deactivated org: org_role_of() (RLS, signed-in callers) and
--   actor_org_role() (service-role edge functions that pass the actor). Super admins are unaffected.
-- * Delete an organisation permanently: only once it is deactivated, only by a super admin, and only after typing its
--   exact name. Credit ledger rows (the billing record) are copied to b2b_deleted_orgs first, a restricted table nothing
--   in the app reads, kept 8 years. Evidence files are removed by the edge function before this runs.
-- * Delete a drive: only while nobody has started it. Once a student has an attempt or interview in it, the database
--   refuses and the UI offers "Close drive" instead, so results stay with the college.
--
-- Rollback: restore org_role_of / actor_org_role from 20261021000001_b2b_v1_tenancy.sql; DROP TRIGGER
-- drives_delete_guard, org_memberships_active_org; DROP FUNCTION b2b_drive_started, b2b_set_org_active,
-- b2b_delete_org, b2b_purge_deleted_orgs, b2b_access_check; DROP TABLE b2b_deleted_orgs; ALTER TABLE organizations DROP COLUMN deactivated_at, deactivated_by.

ALTER TABLE public.organizations
  ADD COLUMN deactivated_at TIMESTAMPTZ,
  ADD COLUMN deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.org_role_of(_org_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.org_memberships m
  JOIN public.organizations o ON o.id = m.org_id AND o.deactivated_at IS NULL
  WHERE m.org_id = _org_id AND m.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.actor_org_role(_actor UUID, _org_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.org_memberships m
  JOIN public.organizations o ON o.id = m.org_id AND o.deactivated_at IS NULL
  WHERE m.org_id = _org_id AND m.user_id = _actor
$$;

-- Nobody joins a deactivated org (invite acceptance, imports and staff invites all insert memberships).
-- SECURITY DEFINER: signed-in callers can't read deactivated_at (column grants), but the check must see it.
CREATE OR REPLACE FUNCTION public.b2b_membership_org_active()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ORG_DEACTIVATED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER org_memberships_active_org BEFORE INSERT ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.b2b_membership_org_active();

-- ── Deactivate / reactivate ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.b2b_set_org_active(_actor UUID, _org_id UUID, _active BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.organizations;
BEGIN
  IF NOT public.actor_is_super_admin(_actor) THEN RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN'); END IF;
  SELECT * INTO o FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  UPDATE public.organizations
     SET deactivated_at = CASE WHEN _active THEN NULL ELSE COALESCE(o.deactivated_at, now()) END,
         deactivated_by = CASE WHEN _active THEN NULL ELSE COALESCE(o.deactivated_by, _actor) END,
         updated_at = now()
   WHERE id = _org_id;
  INSERT INTO public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
    VALUES (_org_id, _actor, CASE WHEN _active THEN 'org.reactivate' ELSE 'org.deactivate' END, 'organization',
            _org_id::text, jsonb_build_object('name', o.name));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Delete permanently ───────────────────────────────────────────────────────────────────────────────────────────
-- Restricted store: RLS on, no policies, so only the service role can read it. Purged after delete_after.
CREATE TABLE public.b2b_deleted_orgs (
  org_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  deleted_by UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credit_ledger JSONB NOT NULL DEFAULT '[]'::jsonb,
  delete_after TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '8 years')
);
ALTER TABLE public.b2b_deleted_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.b2b_deleted_orgs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.b2b_delete_org(_actor UUID, _org_id UUID, _confirm_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.organizations;
BEGIN
  IF NOT public.actor_is_super_admin(_actor) THEN RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN'); END IF;
  SELECT * INTO o FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF o.deactivated_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_DEACTIVATED'); END IF;
  IF btrim(coalesce(_confirm_name, '')) <> btrim(o.name) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NAME_MISMATCH');
  END IF;

  INSERT INTO public.b2b_deleted_orgs (org_id, name, type, deleted_by, credit_ledger)
  SELECT o.id, o.name, o.type::text, _actor,
         COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.org_credit_ledger l WHERE l.org_id = o.id), '[]'::jsonb)
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
    VALUES (o.id, _actor, 'org.delete', 'organization', o.id::text, jsonb_build_object('name', o.name, 'type', o.type));

  DELETE FROM public.organizations WHERE id = o.id;   -- everything else cascades
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.b2b_set_org_active(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.b2b_delete_org(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_set_org_active(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_delete_org(UUID, UUID, TEXT) TO service_role;

-- Purge the restricted copies once their legal period is over.
CREATE OR REPLACE FUNCTION public.b2b_purge_deleted_orgs()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM public.b2b_deleted_orgs WHERE delete_after < now() RETURNING 1) SELECT count(*)::int FROM d
$$;
REVOKE EXECUTE ON FUNCTION public.b2b_purge_deleted_orgs() FROM PUBLIC, anon, authenticated;
-- Scheduled daily in 20261109000002_schedule_purge_deleted_orgs.sql.

-- ── Drives: delete only while unused ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.b2b_drive_started(_drive_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.attempts WHERE context_type = 'drive' AND context_id = _drive_id)
      OR EXISTS (SELECT 1 FROM public.b2b_interviews WHERE kind = 'drive' AND context_id = _drive_id)
      OR EXISTS (SELECT 1 FROM public.drive_assignments
                 WHERE drive_id = _drive_id AND (attempt_id IS NOT NULL OR interview_id IS NOT NULL
                                                 OR status IN ('in_progress', 'completed')))
$$;
GRANT EXECUTE ON FUNCTION public.b2b_drive_started(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.b2b_drive_delete_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Org deletion cascades through drives; that path is already confirmed by name and audited.
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN RETURN OLD; END IF;
  IF public.b2b_drive_started(OLD.id) THEN
    RAISE EXCEPTION 'DRIVE_STARTED' USING ERRCODE = 'P0001',
      HINT = 'Students have started this drive. Close it instead so their results are kept.';
  END IF;
  RETURN OLD;   -- audit_drives logs the delete itself
END $$;

CREATE TRIGGER drives_delete_guard BEFORE DELETE ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.b2b_drive_delete_guard();

-- ── Who may use the app after signing in ─────────────────────────────────────────────────────────────────────────
-- Called by the app right after sign-in. Super admins, staff of an active org and plain B2C users pass. Members whose
-- every org is deactivated are refused, and so are students with no drive assigned to them (owner decision: students
-- see nothing and cannot sign in until a drive is assigned; a past drive keeps access so they can see results).
CREATE OR REPLACE FUNCTION public.b2b_access_check()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'SIGNED_OUT'); END IF;
  IF public.is_super_admin() THEN RETURN jsonb_build_object('ok', true); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_memberships WHERE user_id = v_uid) THEN RETURN jsonb_build_object('ok', true); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_memberships m JOIN public.organizations o ON o.id = m.org_id
                 WHERE m.user_id = v_uid AND o.deactivated_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORG_DEACTIVATED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_memberships m JOIN public.organizations o ON o.id = m.org_id
             WHERE m.user_id = v_uid AND o.deactivated_at IS NULL AND m.role <> 'student') THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.drive_assignments da
             JOIN public.students s ON s.id = da.student_id
             JOIN public.organizations o ON o.id = da.org_id AND o.deactivated_at IS NULL
             WHERE s.user_id = v_uid AND s.status <> 'deactivated' AND da.status <> 'removed') THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'NO_DRIVE');
END $$;
REVOKE EXECUTE ON FUNCTION public.b2b_access_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_access_check() TO authenticated;
