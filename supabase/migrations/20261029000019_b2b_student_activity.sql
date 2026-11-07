-- Student activity instead of counted login sessions (owner decision 2026-10-29, replaces R1.5/R1.6 as written).
-- No credits are charged for logging in. What we record is what a student was given and what they did:
--   activated (accepted their invite) → assigned (TPO added them to a drive) → started → completed | absent | removed.
-- A student sees only the drives their TPO assigned; each drive is one attempt (drive_assignments is unique per
-- drive + student, attempts are reused), so after completing it they see it as completed until the TPO assigns another.
--  * student_activity: append-only; rows are written only by the triggers below (no client write policies).
--  * students.last_active_at: when the student last started or finished something (for the TPO roster).
--  * Seats (R1.4): a student's seat counts as used once they activate their account (seat_locked_at), so a TPO
--    can't deactivate someone who has used HiResume to free a seat. Super admins can still free it (super_free_seat).
-- Rollback: DROP TABLE public.student_activity; DROP TRIGGER drive_assignments_activity ON public.drive_assignments;
-- DROP TRIGGER students_activation_activity ON public.students; DROP TRIGGER students_activation_seat ON public.students;
-- DROP FUNCTION public.b2b_log_assignment_activity(), public.b2b_log_activation(), public.b2b_stamp_activation_seat(),
-- public.b2b_student_activity_summary(uuid); ALTER TABLE public.students DROP COLUMN last_active_at.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.student_activity (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL,
  student_id UUID NOT NULL,
  drive_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('activated', 'assigned', 'started', 'completed', 'absent', 'removed')),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, org_id) REFERENCES public.students(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (drive_id) REFERENCES public.drives(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_student_activity_student ON public.student_activity (student_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_student_activity_org ON public.student_activity (org_id, at DESC);

ALTER TABLE public.student_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read student activity" ON public.student_activity FOR SELECT TO authenticated USING (
  public.is_super_admin() OR public.is_org_staff(org_id)
  OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
);
-- No INSERT / UPDATE / DELETE policies: only the definer triggers below write.

-- Drive assignment lifecycle → activity rows.
CREATE OR REPLACE FUNCTION public.b2b_log_assignment_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := CASE WHEN NEW.status = 'assigned' THEN 'assigned' WHEN NEW.status = 'in_progress' THEN 'started'
                   WHEN NEW.status IN ('completed', 'absent', 'removed') THEN NEW.status END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := CASE NEW.status WHEN 'in_progress' THEN 'started' WHEN 'assigned' THEN 'assigned' ELSE NEW.status END;
  END IF;
  IF v_kind IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.student_activity (org_id, student_id, drive_id, kind) VALUES (NEW.org_id, NEW.student_id, NEW.drive_id, v_kind);
  IF v_kind IN ('started', 'completed') THEN
    UPDATE public.students SET last_active_at = now() WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_log_assignment_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS drive_assignments_activity ON public.drive_assignments;
CREATE TRIGGER drive_assignments_activity AFTER INSERT OR UPDATE OF status ON public.drive_assignments
  FOR EACH ROW EXECUTE FUNCTION public.b2b_log_assignment_activity();

-- Activation: the seat counts as used from here on (R1.4).
CREATE OR REPLACE FUNCTION public.b2b_stamp_activation_seat()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    NEW.seat_locked_at := COALESCE(NEW.seat_locked_at, now());
    NEW.last_active_at := COALESCE(NEW.last_active_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS students_activation_seat ON public.students;
CREATE TRIGGER students_activation_seat BEFORE INSERT OR UPDATE OF status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.b2b_stamp_activation_seat();

CREATE OR REPLACE FUNCTION public.b2b_log_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    INSERT INTO public.student_activity (org_id, student_id, kind) VALUES (NEW.org_id, NEW.id, 'activated');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_log_activation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS students_activation_activity ON public.students;
CREATE TRIGGER students_activation_activity AFTER INSERT OR UPDATE OF status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.b2b_log_activation();

-- Per-student counts for the TPO roster: { "<student_id>": { assigned, completed, last_active_at } }.
-- SECURITY INVOKER: RLS on drive_assignments / students decides what the caller sees.
CREATE OR REPLACE FUNCTION public.b2b_student_activity_summary(_org_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(s.id, jsonb_build_object(
           'assigned', COALESCE(a.assigned, 0), 'completed', COALESCE(a.completed, 0), 'last_active_at', s.last_active_at)),
         '{}'::jsonb)
  FROM public.students s
  LEFT JOIN (
    SELECT student_id, count(*) FILTER (WHERE status <> 'removed') AS assigned,
           count(*) FILTER (WHERE status = 'completed') AS completed
    FROM public.drive_assignments WHERE org_id = _org_id GROUP BY student_id
  ) a ON a.student_id = s.id
  WHERE s.org_id = _org_id
$$;
REVOKE ALL ON FUNCTION public.b2b_student_activity_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_student_activity_summary(UUID) TO authenticated, service_role;

-- Backfill: history from existing assignments, and seats of students who already activated.
INSERT INTO public.student_activity (org_id, student_id, drive_id, kind, at)
  SELECT org_id, student_id, drive_id, 'assigned', assigned_at FROM public.drive_assignments;
INSERT INTO public.student_activity (org_id, student_id, drive_id, kind, at)
  SELECT org_id, student_id, drive_id, 'completed', completed_at FROM public.drive_assignments
  WHERE status = 'completed' AND completed_at IS NOT NULL;
UPDATE public.students SET seat_locked_at = COALESCE(seat_locked_at, updated_at, now())
  WHERE status = 'active' OR user_id IS NOT NULL;
