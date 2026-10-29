-- Gemini Live spike tokens (b2b-interview liveToken). Outside an interview, any org admin, trainer or recruiter of any
-- organisation could mint a platform-key Live token; the spike is a developer latency tool, so that path is now
-- super admin only. Inside an interview the subject of an in-progress interview may still get one (the edge function
-- also requires B2B_LIVE_SPIKE=true before it asks).
CREATE OR REPLACE FUNCTION public.b2b_iv_live_allowed(_actor UUID, _interview_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND CASE
    WHEN _interview_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.b2b_interviews WHERE id = _interview_id AND user_id = _actor AND status::text = 'in_progress')
    ELSE public.actor_is_super_admin(_actor)
  END
$$;
