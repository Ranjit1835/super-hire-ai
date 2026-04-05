-- Add resume_builder_id to payments table to correctly identify which resume build was paid for
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS resume_builder_id UUID REFERENCES public.resume_builders(id);
