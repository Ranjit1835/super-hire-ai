
-- Guest analyses table for unauthenticated resume analysis
CREATE TABLE public.guest_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL UNIQUE,
  analysis_result jsonb NOT NULL,
  resume_text text,
  file_name text NOT NULL,
  content_hash text NOT NULL,
  ats_score integer,
  structure_score integer,
  keyword_strength_score integer,
  quantification_score integer,
  recruiter_scan_score integer,
  interview_probability integer,
  market_competitiveness text,
  resume_type text DEFAULT 'PROFESSIONAL',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 minutes'),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- RLS: deny all direct user access (edge functions use service role)
ALTER TABLE public.guest_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all direct access" ON public.guest_analyses FOR ALL USING (false);

-- Index for cleanup and lookups
CREATE INDEX idx_guest_analyses_expires ON public.guest_analyses (expires_at);
CREATE INDEX idx_guest_analyses_token ON public.guest_analyses (session_token);
