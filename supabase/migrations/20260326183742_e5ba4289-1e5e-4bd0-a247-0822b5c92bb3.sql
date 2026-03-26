
-- Interview sessions table
CREATE TABLE public.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL,
  experience_level text NOT NULL CHECK (experience_level IN ('fresher', 'mid', 'senior')),
  conversation_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  scores_json jsonb,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  is_paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own interview sessions" ON public.interview_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own interview sessions" ON public.interview_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own interview sessions" ON public.interview_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Add monthly interview tracking to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_interview_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interview_reset_date timestamptz DEFAULT now();

-- Update payments check constraint to include MOCK_INTERVIEW
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type = ANY (ARRAY['ONE_TIME_FIX'::text, 'EARLY_BIRD_ACCESS'::text, 'RESUME_BUILDER'::text, 'MOCK_INTERVIEW'::text]));
