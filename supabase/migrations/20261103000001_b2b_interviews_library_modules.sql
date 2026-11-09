-- Library interview modules (org_id NULL) can be used by drives and job roles (the forms offer them, and
-- b2b_module_belongs_to_org allows them), but b2b_interviews referenced (module_id, org_id), which a library
-- module can never match: every drive interview on a library module failed at b2b_iv_create.
-- Reference the module by id only, and keep the tenant guard as a trigger: the module is the interview's own
-- org's or a library module. V1 interviews snapshot the spec and template, so the reference is for reporting.

ALTER TABLE public.b2b_interviews DROP CONSTRAINT IF EXISTS b2b_interviews_module_id_org_id_fkey;
ALTER TABLE public.b2b_interviews
  ADD CONSTRAINT b2b_interviews_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.interview_modules(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.b2b_interview_module_in_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.module_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interview_modules m
    WHERE m.id = NEW.module_id AND (m.org_id IS NULL OR m.org_id = NEW.org_id)
  ) THEN
    RAISE EXCEPTION 'MODULE_NOT_IN_ORG' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_interview_module_in_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS b2b_interviews_module_in_org ON public.b2b_interviews;
CREATE TRIGGER b2b_interviews_module_in_org BEFORE INSERT OR UPDATE OF module_id, org_id ON public.b2b_interviews
  FOR EACH ROW EXECUTE FUNCTION public.b2b_interview_module_in_org();
