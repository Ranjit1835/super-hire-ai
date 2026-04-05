-- Referral credits system

-- Add referral columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS referral_credits INTEGER DEFAULT 0;

-- Generate referral codes for existing users
UPDATE public.profiles
  SET referral_code = UPPER(SUBSTRING(MD5(user_id::text) FROM 1 FOR 8))
  WHERE referral_code IS NULL;

-- Trigger to auto-generate referral code on new profiles
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(NEW.user_id::text) FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  referred_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  credit_awarded BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(referred_user_id)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referrals" ON public.referrals
  FOR SELECT USING (auth.uid() = (SELECT user_id FROM public.profiles WHERE id = referrer_id));

-- Function to award referral credit after referred user completes first analysis
CREATE OR REPLACE FUNCTION public.award_referral_credit(p_referred_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referral public.referrals;
BEGIN
  SELECT * INTO v_referral FROM public.referrals WHERE referred_user_id = p_referred_user_id AND credit_awarded = false;
  IF FOUND THEN
    UPDATE public.profiles SET referral_credits = referral_credits + 1 WHERE id = v_referral.referrer_id;
    UPDATE public.referrals SET credit_awarded = true WHERE id = v_referral.id;
  END IF;
END;
$$;

-- Index for fast referral code lookup
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);
