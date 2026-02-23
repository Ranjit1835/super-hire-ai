
-- Global deterministic score cache (service-role only, no user access)
CREATE TABLE public.resume_score_cache (
  content_hash text PRIMARY KEY,
  ats_score integer NOT NULL,
  recruiter_scan_score integer NOT NULL,
  keyword_strength_score integer NOT NULL,
  quantification_score integer NOT NULL,
  structure_score integer NOT NULL,
  interview_probability integer NOT NULL,
  market_competitiveness text,
  analysis_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS but deny all user access (service-role bypasses RLS)
ALTER TABLE public.resume_score_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all user access to score cache"
  ON public.resume_score_cache
  AS RESTRICTIVE
  FOR ALL
  USING (false);
