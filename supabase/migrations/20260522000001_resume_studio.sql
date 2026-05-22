-- Resume Studio: conversational AI resume editor
-- 5 new tables prefixed studio_*

-- =============================================
-- 1. studio_resumes — parsed resume data
-- =============================================
CREATE TABLE IF NOT EXISTS public.studio_resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  original_pdf_url TEXT,
  parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  title TEXT DEFAULT 'Untitled Resume',
  template_id TEXT DEFAULT 'classic-ats',
  persona TEXT DEFAULT 'big-tech',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own studio resumes" ON public.studio_resumes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own studio resumes" ON public.studio_resumes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own studio resumes" ON public.studio_resumes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own studio resumes" ON public.studio_resumes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_studio_resumes_user ON public.studio_resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_studio_resumes_updated ON public.studio_resumes(updated_at DESC);

-- =============================================
-- 2. studio_sessions — paid access sessions
-- =============================================
CREATE TABLE IF NOT EXISTS public.studio_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  resume_id UUID REFERENCES public.studio_resumes(id) ON DELETE CASCADE NOT NULL,
  pass_type TEXT NOT NULL CHECK (pass_type IN ('free', 'single', 'weekly', 'yearly')),
  expires_at TIMESTAMPTZ NOT NULL,
  messages_used INTEGER NOT NULL DEFAULT 0,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own studio sessions" ON public.studio_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own studio sessions" ON public.studio_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own studio sessions" ON public.studio_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_studio_sessions_user ON public.studio_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_studio_sessions_resume ON public.studio_sessions(resume_id);
CREATE INDEX IF NOT EXISTS idx_studio_sessions_expires ON public.studio_sessions(expires_at DESC);

-- =============================================
-- 3. studio_messages — chat history
-- =============================================
CREATE TABLE IF NOT EXISTS public.studio_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.studio_sessions(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  changes_applied JSONB,
  model_used TEXT,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_messages ENABLE ROW LEVEL SECURITY;

-- Messages accessible via session ownership (join check)
CREATE POLICY "Users can view own studio messages" ON public.studio_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.studio_sessions s
      WHERE s.id = studio_messages.session_id AND s.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own studio messages" ON public.studio_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.studio_sessions s
      WHERE s.id = studio_messages.session_id AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_studio_messages_session ON public.studio_messages(session_id, created_at);

-- =============================================
-- 4. studio_versions — auto-saved snapshots
-- =============================================
CREATE TABLE IF NOT EXISTS public.studio_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id UUID REFERENCES public.studio_resumes(id) ON DELETE CASCADE NOT NULL,
  snapshot_json JSONB NOT NULL,
  change_summary TEXT DEFAULT '',
  triggered_by_message_id UUID REFERENCES public.studio_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own studio versions" ON public.studio_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.studio_resumes r
      WHERE r.id = studio_versions.resume_id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own studio versions" ON public.studio_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.studio_resumes r
      WHERE r.id = studio_versions.resume_id AND r.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_studio_versions_resume ON public.studio_versions(resume_id, created_at DESC);

-- =============================================
-- 5. studio_suggestions — smart suggestions
-- =============================================
CREATE TABLE IF NOT EXISTS public.studio_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id UUID REFERENCES public.studio_resumes(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weak_bullet', 'missing_section', 'filler_words', 'inconsistency', 'passive_voice', 'missing_metrics', 'formatting', 'keyword_gap')),
  target_path TEXT,
  suggestion TEXT NOT NULL,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own studio suggestions" ON public.studio_suggestions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.studio_resumes r
      WHERE r.id = studio_suggestions.resume_id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own studio suggestions" ON public.studio_suggestions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.studio_resumes r
      WHERE r.id = studio_suggestions.resume_id AND r.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_studio_suggestions_resume ON public.studio_suggestions(resume_id);
CREATE INDEX IF NOT EXISTS idx_studio_suggestions_type ON public.studio_suggestions(type);

-- =============================================
-- Extend payments table CHECK constraint for Studio
-- =============================================
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN (
    'ONE_TIME_FIX', 'EARLY_BIRD_ACCESS', 'RESUME_BUILDER', 'MOCK_INTERVIEW',
    'RESUME_FIX', 'RESUME_BUILD', 'AI_INTERVIEW', 'COMBO_PLAN', 'UNLIMITED_PLAN',
    'STUDIO_SINGLE', 'STUDIO_WEEKLY', 'STUDIO_YEARLY'
  ));
