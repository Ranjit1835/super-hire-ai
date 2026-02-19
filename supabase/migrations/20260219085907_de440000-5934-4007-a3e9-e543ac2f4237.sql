
-- Fix: Remove overly permissive policies, replace with restrictive ones
-- otp_codes should only be accessible via service role (edge functions), not by users directly
DROP POLICY "Service role manages OTP codes" ON public.otp_codes;

-- No user-facing policies needed for otp_codes - edge functions use service role key
-- Add a deny-all policy so no anon/authenticated user can access
CREATE POLICY "Deny all user access to OTP codes"
  ON public.otp_codes
  FOR ALL
  USING (false);

-- Fix user_sessions: remove the permissive service role policy  
DROP POLICY "Service role manages sessions" ON public.user_sessions;

-- Edge functions use service role key which bypasses RLS, so no permissive policy needed
-- Keep the existing SELECT and DELETE policies for authenticated users
