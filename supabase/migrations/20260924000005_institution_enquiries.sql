-- Institution enquiries from /college-placement ("Partner With Us").
-- Visitors (anon) can only submit through submit_institution_enquiry(), which validates input,
-- rate-limits by hashed IP and by email, and drops obvious bots (honeypot). Only super-admins
-- can read enquiries, and they can change only status and notes.

CREATE TABLE public.institution_enquiries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  role             TEXT NOT NULL CHECK (length(btrim(role)) BETWEEN 2 AND 120),
  institution      TEXT NOT NULL CHECK (length(btrim(institution)) BETWEEN 2 AND 200),
  email            TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' AND length(email) <= 254),
  phone            TEXT CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{7,20}$'),
  students         TEXT CHECK (students IS NULL OR length(students) <= 40),
  message          TEXT CHECK (message IS NULL OR length(message) <= 2000),
  source           TEXT CHECK (source IS NULL OR length(source) <= 200),
  ip_hash          TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'demo_scheduled', 'pilot', 'won', 'lost', 'spam')),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  handled_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX institution_enquiries_created_idx ON public.institution_enquiries (created_at DESC);
CREATE INDEX institution_enquiries_ip_idx ON public.institution_enquiries (ip_hash, created_at);
CREATE INDEX institution_enquiries_email_idx ON public.institution_enquiries (lower(email), created_at);

ALTER TABLE public.institution_enquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super-admins read enquiries" ON public.institution_enquiries
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Super-admins update enquiries" ON public.institution_enquiries
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- No INSERT/DELETE policies: inserts only via submit_institution_enquiry().

-- Super-admins may change status/notes only; contact details stay as submitted.
CREATE OR REPLACE FUNCTION public.institution_enquiries_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND (
       NEW.name IS DISTINCT FROM OLD.name OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.institution IS DISTINCT FROM OLD.institution OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.students IS DISTINCT FROM OLD.students
    OR NEW.message IS DISTINCT FROM OLD.message OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.ip_hash IS DISTINCT FROM OLD.ip_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Only status and notes can be changed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  NEW.handled_by := auth.uid();
  RETURN NEW;
END $$;

CREATE TRIGGER institution_enquiries_guard
  BEFORE UPDATE ON public.institution_enquiries
  FOR EACH ROW EXECUTE FUNCTION public.institution_enquiries_guard();

-- Client IP as seen by PostgREST (Supabase sets request.headers); hashed, never stored raw.
CREATE OR REPLACE FUNCTION public.request_ip_hash()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN ip IS NULL OR ip = '' THEN NULL
              ELSE encode(sha256(convert_to('hiresume-enquiry:' || ip, 'UTF8')), 'hex') END
  FROM (
    SELECT btrim(coalesce(
      h->>'cf-connecting-ip',
      h->>'x-real-ip',
      split_part(h->>'x-forwarded-for', ',', 1)
    )) AS ip
    FROM (SELECT nullif(current_setting('request.headers', true), '')::json AS h) s
  ) t
$$;
REVOKE EXECUTE ON FUNCTION public.request_ip_hash() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_institution_enquiry(
  _name TEXT, _role TEXT, _institution TEXT, _email TEXT,
  _phone TEXT DEFAULT NULL, _students TEXT DEFAULT NULL, _message TEXT DEFAULT NULL,
  _source TEXT DEFAULT NULL, _website TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ip TEXT := public.request_ip_hash();
  em TEXT := lower(btrim(coalesce(_email, '')));
  ph TEXT := nullif(btrim(coalesce(_phone, '')), '');
BEGIN
  -- Honeypot: humans never fill the hidden "website" field. Pretend success.
  IF coalesce(btrim(_website), '') <> '' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF length(btrim(coalesce(_name, ''))) < 2 OR length(btrim(coalesce(_role, ''))) < 2
     OR length(btrim(coalesce(_institution, ''))) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_FIELDS');
  END IF;
  IF em !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(em) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_EMAIL');
  END IF;
  IF ph IS NOT NULL AND ph !~ '^\+?[0-9 ()-]{7,20}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_PHONE');
  END IF;
  IF length(coalesce(_message, '')) > 2000 OR length(btrim(_name)) > 120 OR length(btrim(_role)) > 120
     OR length(btrim(_institution)) > 200 OR length(coalesce(_students, '')) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LONG');
  END IF;

  -- Rate limits: per IP (5/hour, 10/day), per email (3/day), and a global daily ceiling.
  IF ip IS NOT NULL AND (
       (SELECT count(*) FROM public.institution_enquiries WHERE ip_hash = ip AND created_at > now() - interval '1 hour') >= 5
    OR (SELECT count(*) FROM public.institution_enquiries WHERE ip_hash = ip AND created_at > now() - interval '1 day') >= 10
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;
  IF (SELECT count(*) FROM public.institution_enquiries WHERE lower(email) = em AND created_at > now() - interval '1 day') >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_RECEIVED');
  END IF;
  IF (SELECT count(*) FROM public.institution_enquiries WHERE created_at > now() - interval '1 day') >= 300 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.institution_enquiries (name, role, institution, email, phone, students, message, source, ip_hash)
  VALUES (btrim(_name), btrim(_role), btrim(_institution), em, ph,
          nullif(btrim(coalesce(_students, '')), ''), nullif(btrim(coalesce(_message, '')), ''),
          nullif(left(btrim(coalesce(_source, '')), 200), ''), ip);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.submit_institution_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_institution_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Badge count for the admin header.
CREATE OR REPLACE FUNCTION public.super_new_enquiry_count()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.is_super_admin()
    THEN (SELECT count(*)::int FROM public.institution_enquiries WHERE status = 'new') ELSE 0 END
$$;
REVOKE EXECUTE ON FUNCTION public.super_new_enquiry_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_new_enquiry_count() TO authenticated;
