-- B2B multi-tenancy: organizations, batches, org memberships.
-- B2C is untouched: a B2C user simply has no org_memberships row.
-- Isolation is enforced by RLS. Edge functions using the service role bypass RLS
-- and must check membership themselves (see _shared/org.ts in later steps).

CREATE TYPE public.org_type AS ENUM ('college', 'coaching_institute');
CREATE TYPE public.org_member_role AS ENUM ('org_admin', 'trainer', 'student');

-- =============================================
-- Tables
-- =============================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  type public.org_type NOT NULL,
  logo_url TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  department TEXT,
  course TEXT,
  start_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name),
  UNIQUE (id, org_id) -- target for composite FKs so child rows can't point at another org's batch
);

-- Student-facing identity (name, roll_no) lives here, scoped to the org, so staff
-- never need access to the B2C profiles table.
CREATE TABLE public.org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL,
  batch_id UUID,
  full_name TEXT,
  email TEXT,
  roll_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id),
  FOREIGN KEY (batch_id, org_id) REFERENCES public.batches(id, org_id) ON DELETE SET NULL (batch_id)
);

CREATE UNIQUE INDEX idx_org_memberships_roll_no ON public.org_memberships(org_id, roll_no) WHERE roll_no IS NOT NULL;
CREATE INDEX idx_org_memberships_user ON public.org_memberships(user_id);
CREATE INDEX idx_org_memberships_batch ON public.org_memberships(batch_id);
CREATE INDEX idx_batches_org ON public.batches(org_id);

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A membership can never be re-pointed at another user or org (that would let an
-- org admin silently pull an arbitrary user into their org, or move rows across orgs).
CREATE OR REPLACE FUNCTION public.org_memberships_immutable_keys()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'org_memberships.user_id and org_id are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_memberships_immutable_keys
  BEFORE UPDATE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.org_memberships_immutable_keys();

-- =============================================
-- Helper functions (SECURITY DEFINER so policies can consult memberships
-- without recursing through org_memberships' own RLS)
-- =============================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_org_id UUID)
RETURNS public.org_member_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.org_memberships WHERE org_id = _org_id AND user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.org_role_of(_org_id) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.is_org_staff(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.org_role_of(_org_id) IN ('org_admin', 'trainer')
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.org_role_of(_org_id) = 'org_admin'
$$;

CREATE OR REPLACE FUNCTION public.my_batch_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT batch_id FROM public.org_memberships WHERE user_id = auth.uid() AND batch_id IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(), public.org_role_of(UUID), public.is_org_member(UUID),
  public.is_org_staff(UUID), public.is_org_admin(UUID), public.my_batch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(), public.org_role_of(UUID), public.is_org_member(UUID),
  public.is_org_staff(UUID), public.is_org_admin(UUID), public.my_batch_ids() TO authenticated;

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

-- organizations: members read their org; only super-admin creates/changes/deletes orgs.
CREATE POLICY "Members read own org" ON public.organizations
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.is_org_member(id));
CREATE POLICY "Super-admin inserts orgs" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());
CREATE POLICY "Super-admin updates orgs" ON public.organizations
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Super-admin deletes orgs" ON public.organizations
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- batches: staff see all batches of their org, students only their own batch.
CREATE POLICY "Read batches" ON public.batches
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.is_org_staff(org_id) OR id IN (SELECT public.my_batch_ids())
  );
CREATE POLICY "Org admin inserts batches" ON public.batches
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));
CREATE POLICY "Org admin updates batches" ON public.batches
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));
CREATE POLICY "Org admin deletes batches" ON public.batches
  FOR DELETE TO authenticated USING (public.is_super_admin() OR public.is_org_admin(org_id));

-- org_memberships: you see your own rows; staff see their org's roster.
-- Rows are created only by super-admin or by the invite-acceptance edge function
-- (service role) — an org admin cannot attach arbitrary users.
CREATE POLICY "Read memberships" ON public.org_memberships
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR user_id = auth.uid() OR public.is_org_staff(org_id)
  );
CREATE POLICY "Super-admin inserts memberships" ON public.org_memberships
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());
CREATE POLICY "Org admin updates memberships" ON public.org_memberships
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_admin(org_id));
CREATE POLICY "Org admin deletes memberships" ON public.org_memberships
  FOR DELETE TO authenticated USING (public.is_super_admin() OR public.is_org_admin(org_id));
