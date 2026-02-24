
-- Create payments table
CREATE TABLE public.payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  resume_analysis_id UUID REFERENCES public.resume_analyses(id),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('ONE_TIME_FIX', 'EARLY_BIRD_ACCESS')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Users can only read their own payments
CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Alter profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS early_bird_active BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_bird_expiry_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS total_payments INTEGER DEFAULT 0;

-- Alter resume_analyses table
ALTER TABLE public.resume_analyses
  ADD COLUMN IF NOT EXISTS is_paid_fix_unlocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_fix_unlocked_at TIMESTAMP WITH TIME ZONE;

-- Add UPDATE policy for resume_analyses (needed by edge functions via service role, but also for completeness)
-- resume_analyses currently has no UPDATE policy - edge functions use service role so this is fine
