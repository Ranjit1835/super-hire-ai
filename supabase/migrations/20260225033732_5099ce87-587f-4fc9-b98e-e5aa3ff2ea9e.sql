
-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create function to expire early bird subscriptions
CREATE OR REPLACE FUNCTION public.expire_early_bird_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET early_bird_active = false
  WHERE early_bird_active = true
    AND early_bird_expiry_date < now();
END;
$$;
