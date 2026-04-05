-- Track login attempts for server-side rate limiting
CREATE TABLE public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

-- Index for fast rate-limit queries: filter by email + time window
CREATE INDEX idx_login_attempts_email_time ON public.login_attempts(email, attempted_at);

-- Disable RLS (this table is only written to by service role in edge functions)
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Auto-clean attempts older than 24 hours to prevent table bloat
CREATE OR REPLACE FUNCTION public.clean_old_login_attempts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.login_attempts WHERE attempted_at < now() - INTERVAL '24 hours';
END;
$$;

SELECT cron.schedule(
  'clean-login-attempts',
  '0 * * * *',
  $$SELECT public.clean_old_login_attempts()$$
);
