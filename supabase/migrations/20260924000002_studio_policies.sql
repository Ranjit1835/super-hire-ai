-- Reconcile Resume Studio RLS with what the app needs, safely.
--
-- Production was set up by hand with 8 of the 13 policies in 20260522000001_resume_studio.sql.
-- All Studio writes except resume template/persona updates go through edge functions using the
-- service role (which bypasses RLS), so users need very little direct write access.
--
-- Paid access is decided from studio_sessions (pass_type, expires_at, messages_used), so users
-- must never write that table directly: an INSERT or UPDATE policy lets anyone grant themselves
-- a yearly pass. Sessions are created and updated only by studio-create-session / studio-chat.
-- studio_messages is also server-only: studio-chat replays the history to the model, so direct
-- inserts would allow forged assistant turns and inflated model costs.
-- Names differ between the file and production, so both spellings are handled.

-- studio_sessions: read-only for users
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.studio_sessions;
DROP POLICY IF EXISTS "Users can insert own studio sessions" ON public.studio_sessions;
DROP POLICY IF EXISTS "Users can update own studio sessions" ON public.studio_sessions;

-- studio_messages: read-only for users
DROP POLICY IF EXISTS "Users can insert own studio messages" ON public.studio_messages;

-- studio_resumes: users may delete their own resume (sessions/versions/suggestions cascade)
DROP POLICY IF EXISTS "Users can delete own studio resumes" ON public.studio_resumes;
CREATE POLICY "Users can delete own studio resumes" ON public.studio_resumes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- studio_versions: users may snapshot their own resume
DROP POLICY IF EXISTS "Users can insert own studio versions" ON public.studio_versions;
CREATE POLICY "Users can insert own studio versions" ON public.studio_versions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.studio_resumes r
    WHERE r.id = studio_versions.resume_id AND r.user_id = auth.uid()
  ));

-- studio_suggestions: users may mark suggestions on their own resume (cannot move them to another resume)
DROP POLICY IF EXISTS "Users can update own studio suggestions" ON public.studio_suggestions;
CREATE POLICY "Users can update own studio suggestions" ON public.studio_suggestions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.studio_resumes r
    WHERE r.id = studio_suggestions.resume_id AND r.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.studio_resumes r
    WHERE r.id = studio_suggestions.resume_id AND r.user_id = auth.uid()
  ));
