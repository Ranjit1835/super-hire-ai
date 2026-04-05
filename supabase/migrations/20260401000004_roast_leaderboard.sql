-- Public leaderboard for opt-in score sharing

CREATE TABLE IF NOT EXISTS public.leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  analysis_id UUID REFERENCES public.resume_analyses(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',  -- user-chosen alias
  college TEXT,
  industry TEXT,
  role_target TEXT,
  ats_score INTEGER NOT NULL,
  improvement INTEGER DEFAULT 0,  -- score gain vs their previous best
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(analysis_id)
);

ALTER TABLE public.leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view public leaderboard" ON public.leaderboard_entries
  FOR SELECT USING (is_public = true);

CREATE POLICY "Users can manage own entries" ON public.leaderboard_entries
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON public.leaderboard_entries(ats_score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_created ON public.leaderboard_entries(created_at DESC);
