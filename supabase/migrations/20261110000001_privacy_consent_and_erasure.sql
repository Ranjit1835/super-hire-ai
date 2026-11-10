-- DPDP Act 2023 / Rules 2025 (owner decisions 2026-11-09): recorded consent to the privacy notice, and account
-- deletion from the app.
--
-- * user_consents: one row per user, purpose and notice version, with the exact text shown and a timestamp. Users
--   insert and read only their own; withdrawing is deleting the account (or emailing privacy@hiresume.in).
-- * privacy_delete_account(): called by the account-delete edge function for the signed-in user. B2C accounts only:
--   college/company members are refused (their college holds their results, and deleting the auth user would cascade
--   into the college's attempts), so they ask their organisation or privacy@ instead. Payments are copied to
--   retained_payment_records (restricted: RLS on, no policies; kept 8 years for tax law, then purged) and every table
--   keyed by the user without a foreign key is cleared. The edge function then removes their resume files and the
--   auth user, whose ON DELETE CASCADE removes the rest (profiles, analyses, studio, leaderboard, consents...).
--
-- Rollback: DROP FUNCTION privacy_delete_account, privacy_purge_retained; DROP TABLE user_consents,
-- retained_payment_records.

CREATE TABLE public.user_consents (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('privacy_notice', 'age_18_plus')),
  notice_version TEXT NOT NULL CHECK (length(notice_version) BETWEEN 1 AND 40),
  consent_text TEXT NOT NULL CHECK (length(consent_text) BETWEEN 10 AND 2000),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, purpose, notice_version)
);
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own consents: read" ON public.user_consents FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own consents: give" ON public.user_consents FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND granted_at > now() - interval '5 minutes');
GRANT SELECT, INSERT ON public.user_consents TO authenticated;
GRANT USAGE ON SEQUENCE public.user_consents_id_seq TO authenticated;

CREATE TABLE public.retained_payment_records (
  payment_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,                -- no FK: the account is gone; this is the tax record
  record JSONB NOT NULL,
  account_deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '8 years')
);
ALTER TABLE public.retained_payment_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_payment_records FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.privacy_delete_account(_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'SIGNED_OUT'); END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SUPER_ADMIN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_memberships WHERE user_id = _actor) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'B2B_MEMBER');
  END IF;

  INSERT INTO public.retained_payment_records (payment_id, user_id, record)
  SELECT p.id, p.user_id, to_jsonb(p) - 'razorpay_signature' FROM public.payments p WHERE p.user_id = _actor
  ON CONFLICT (payment_id) DO NOTHING;

  DELETE FROM public.payments WHERE user_id = _actor;
  DELETE FROM public.interview_sessions WHERE user_id = _actor;
  DELETE FROM public.user_sessions WHERE user_id = _actor;
  DELETE FROM public.resume_builders WHERE user_id = _actor;
  DELETE FROM public.otp_codes WHERE user_id = _actor;
  DELETE FROM public.guest_analyses WHERE claimed_by = _actor;
  DELETE FROM public.login_attempts
   WHERE lower(email) = (SELECT lower(email) FROM auth.users WHERE id = _actor);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.privacy_delete_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_delete_account(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.privacy_purge_retained()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM public.retained_payment_records WHERE delete_after < now() RETURNING 1) SELECT count(*)::int FROM d
$$;
REVOKE EXECUTE ON FUNCTION public.privacy_purge_retained() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('privacy-purge-retained', '50 21 * * *', $$SELECT public.privacy_purge_retained()$$);
