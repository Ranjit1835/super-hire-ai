
CREATE TABLE public.resume_builders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enhanced_json jsonb,
  template_id text NOT NULL DEFAULT 'minimal-ats',
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.resume_builders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resume builds"
  ON public.resume_builders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resume builds"
  ON public.resume_builders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own resume builds"
  ON public.resume_builders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own resume builds"
  ON public.resume_builders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_resume_builders_updated_at
  BEFORE UPDATE ON public.resume_builders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
