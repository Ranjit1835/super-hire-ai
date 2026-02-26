ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS first_time_fix_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_time_early_bird_used boolean DEFAULT false;