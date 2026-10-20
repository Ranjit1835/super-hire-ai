-- B2B V1 — every remaining V1 table, in dependency order:
--   1. assessment content: questions, test_cases, reference_solutions, assessments
--   2. programs: drives + drive_assignments (college), job_roles + role_candidates + comments (company)
--   3. visibility helpers (who may see a context; when may a subject see their own results)
--   4. attempts: attempts, attempt_answers (autosave), submissions (graded runs), edit_history
--   5. interviews: link the pilot's b2b_interviews to drives / job roles / coding attempts
--   6. proctoring: sessions, events, integrity reviews
--   7. analytics: competency dimensions + normalised dimension scores
--   8. sharing + resume links
-- Writes to subject-facing tables (attempts, answers, submissions, events…) happen only through
-- service-role functions in the edge functions; RLS here governs reads and staff edits.

-- =============================================
-- 1. Assessment content
-- =============================================
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,   -- NULL = global bank (super admin)
  type TEXT NOT NULL CHECK (type IN ('coding', 'mcq')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 10 AND 20000),   -- markdown
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  topics TEXT[] NOT NULL DEFAULT '{}',
  -- MCQ: category aptitude / cs_fundamentals / module topic
  category TEXT CHECK (category IS NULL OR category IN ('aptitude', 'cs_fundamentals', 'technical', 'coding')),
  -- coding
  languages TEXT[] NOT NULL DEFAULT '{}',
  starter_code JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { "python": "...", "java": "..." }
  constraints TEXT,
  time_limit_ms INTEGER CHECK (time_limit_ms IS NULL OR time_limit_ms BETWEEN 100 AND 20000),
  memory_limit_kb INTEGER CHECK (memory_limit_kb IS NULL OR memory_limit_kb BETWEEN 16000 AND 1024000),
  -- mcq: options [{ id, text }], answer = array of correct option ids
  options JSONB,
  answer JSONB,
  multi_select BOOLEAN NOT NULL DEFAULT false,
  explanation TEXT,
  points NUMERIC(6, 2) NOT NULL DEFAULT 1 CHECK (points > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'retired')),
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'import')),
  -- parameterised variant: family id groups variants; params records the numbers used
  family_id UUID,
  params JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'mcq' OR (jsonb_typeof(options) = 'array' AND jsonb_typeof(answer) = 'array')),
  CHECK (type <> 'coding' OR cardinality(languages) > 0)
);
CREATE INDEX idx_questions_bank ON public.questions(org_id, type, status, difficulty);
CREATE INDEX idx_questions_topics ON public.questions USING gin (topics);
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A coding question becomes 'verified' only when the reference solution passed every test in the sandbox,
-- which the service role records. Staff can't mark coding questions verified from the browser.
CREATE OR REPLACE FUNCTION public.questions_verify_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.type = 'coding' AND NEW.status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'verified' OR NEW.statement IS DISTINCT FROM OLD.statement) THEN
    RAISE EXCEPTION 'VERIFY_IN_SANDBOX: coding questions are verified by running the reference solution'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.statement IS DISTINCT FROM OLD.statement OR NEW.answer IS DISTINCT FROM OLD.answer
                           OR NEW.options IS DISTINCT FROM OLD.options) THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER questions_verify_guard BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.questions_verify_guard();

CREATE TABLE public.test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL CHECK (length(input) <= 1000000),
  expected_output TEXT NOT NULL CHECK (length(expected_output) <= 1000000),
  is_sample BOOLEAN NOT NULL DEFAULT false,      -- samples are shown to the candidate; hidden ones never are
  weight NUMERIC(6, 2) NOT NULL DEFAULT 1 CHECK (weight > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_cases_question ON public.test_cases(question_id, ordinal);

CREATE TABLE public.reference_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) <= 100000),
  verified_at TIMESTAMPTZ,       -- set by the sandbox run that passed every test
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, language)
);

CREATE TABLE public.assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  -- [{ "type": "coding"|"mcq", "title", "pick": [{ "difficulty", "topics": [], "count" }] | "question_ids": [] }]
  sections JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sections) = 'array'),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 300),
  languages TEXT[] NOT NULL DEFAULT '{python,java,cpp,javascript}',
  randomize BOOLEAN NOT NULL DEFAULT true,       -- per-candidate selection, order and MCQ option shuffle
  shuffle_options BOOLEAN NOT NULL DEFAULT true,
  negative_marking NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (negative_marking BETWEEN 0 AND 1),
  proctoring_policy TEXT NOT NULL DEFAULT 'standard' CHECK (proctoring_policy IN ('off', 'standard', 'strict', 'maximum')),
  strict_max_violations INTEGER NOT NULL DEFAULT 3 CHECK (strict_max_violations BETWEEN 1 AND 50),
  pause_timer_on_violation BOOLEAN NOT NULL DEFAULT false,   -- maximum policy
  late_join_min INTEGER CHECK (late_join_min IS NULL OR late_join_min >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE TRIGGER update_assessments_updated_at BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER audit_assessments AFTER INSERT OR UPDATE OR DELETE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

-- Any org editor anywhere (global bank questions are readable to staff of any org).
CREATE OR REPLACE FUNCTION public.is_any_org_editor()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_memberships
                 WHERE user_id = auth.uid() AND role IN ('org_admin', 'trainer', 'recruiter'))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_question(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin() OR (_org_id IS NOT NULL AND public.is_org_editor(_org_id))
$$;

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read questions" ON public.questions FOR SELECT TO authenticated USING (
  public.is_super_admin()
  OR (org_id IS NULL AND status = 'verified' AND public.is_any_org_editor())
  OR (org_id IS NOT NULL AND public.is_org_editor(org_id))
);
CREATE POLICY "Insert questions" ON public.questions FOR INSERT TO authenticated WITH CHECK (public.can_edit_question(org_id));
CREATE POLICY "Update questions" ON public.questions FOR UPDATE TO authenticated
  USING (public.can_edit_question(org_id)) WITH CHECK (public.can_edit_question(org_id));
CREATE POLICY "Delete questions" ON public.questions FOR DELETE TO authenticated USING (public.can_edit_question(org_id));

ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Editors manage test cases" ON public.test_cases FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.can_edit_question(q.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.can_edit_question(q.org_id)));

ALTER TABLE public.reference_solutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Editors manage reference solutions" ON public.reference_solutions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.can_edit_question(q.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.can_edit_question(q.org_id)));

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read assessments" ON public.assessments FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_org_staff(org_id));
CREATE POLICY "Editors insert assessments" ON public.assessments FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_org_editor(org_id));
CREATE POLICY "Editors update assessments" ON public.assessments FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_editor(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_editor(org_id));
CREATE POLICY "Editors delete assessments" ON public.assessments FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_org_editor(org_id));

-- =============================================
-- 2. Programs
-- =============================================
CREATE TABLE public.drives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 200),
  description TEXT CHECK (description IS NULL OR length(description) <= 4000),
  assessment_id UUID,
  interview_module_id UUID REFERENCES public.interview_modules(id) ON DELETE SET NULL,
  resume_task BOOLEAN NOT NULL DEFAULT false,
  -- { departments: [], batch_years: [], sections: [], min_cgpa, max_backlogs, min_tenth_pct, min_twelfth_pct }
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility) = 'object'),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  proctoring_policy TEXT NOT NULL DEFAULT 'standard' CHECK (proctoring_policy IN ('off', 'standard', 'strict', 'maximum')),
  results_release TEXT NOT NULL DEFAULT 'manual' CHECK (results_release IN ('immediate', 'manual', 'never')),
  results_released_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'live', 'closed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (assessment_id, org_id) REFERENCES public.assessments(id, org_id) ON DELETE SET NULL (assessment_id),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start)
);
CREATE INDEX idx_drives_org ON public.drives(org_id, status);
CREATE TRIGGER update_drives_updated_at BEFORE UPDATE ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER drives_college_only BEFORE INSERT OR UPDATE OF org_id ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.b2b_require_org_type('college');
CREATE TRIGGER audit_drives AFTER INSERT OR UPDATE OR DELETE ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

CREATE TABLE public.drive_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id UUID NOT NULL,
  org_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'absent', 'removed')),
  attempt_id UUID,
  interview_id UUID,
  accommodations JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { extra_time_pct, relaxed_checks: [] }
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (drive_id, student_id),
  FOREIGN KEY (drive_id, org_id) REFERENCES public.drives(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, org_id) REFERENCES public.students(id, org_id) ON DELETE CASCADE
);
CREATE INDEX idx_drive_assignments_student ON public.drive_assignments(student_id);
CREATE INDEX idx_drive_assignments_drive ON public.drive_assignments(drive_id, status);

CREATE TABLE public.job_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  jd_text TEXT CHECK (jd_text IS NULL OR length(jd_text) <= 30000),
  -- { must_have: [{ skill, weight }], nice_to_have: [{ skill, weight }], seniority }
  skills_matrix JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(skills_matrix) = 'object'),
  seniority TEXT CHECK (seniority IS NULL OR seniority IN ('intern', 'junior', 'mid', 'senior', 'lead')),
  assessment_id UUID,
  interview_module_id UUID REFERENCES public.interview_modules(id) ON DELETE SET NULL,
  code_walkthrough BOOLEAN NOT NULL DEFAULT true,
  proctoring_policy TEXT NOT NULL DEFAULT 'maximum' CHECK (proctoring_policy IN ('off', 'standard', 'strict', 'maximum')),
  invite_expiry_days INTEGER NOT NULL DEFAULT 7 CHECK (invite_expiry_days BETWEEN 1 AND 60),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  hiring_manager_ids UUID[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (assessment_id, org_id) REFERENCES public.assessments(id, org_id) ON DELETE SET NULL (assessment_id)
);
CREATE INDEX idx_job_roles_org ON public.job_roles(org_id, status);
CREATE TRIGGER update_job_roles_updated_at BEFORE UPDATE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER job_roles_company_only BEFORE INSERT OR UPDATE OF org_id ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.b2b_require_org_type('company');
CREATE TRIGGER audit_job_roles AFTER INSERT OR UPDATE OR DELETE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

CREATE TABLE public.role_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  job_role_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  stage TEXT NOT NULL DEFAULT 'invited'
    CHECK (stage IN ('invited', 'in_progress', 'completed', 'shortlisted', 'rejected', 'hired', 'withdrawn')),
  invite_token_hash TEXT UNIQUE CHECK (invite_token_hash IS NULL OR invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempt_id UUID,
  interview_id UUID,
  match_score NUMERIC(5, 2) CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
  recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('strong', 'good', 'borderline', 'not_yet')),
  report JSONB,                  -- assembled candidate report (scores, evidence refs); AI recommendation, humans decide
  decision TEXT CHECK (decision IS NULL OR decision IN ('advance', 'hold', 'reject', 'hire')),
  decision_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_at TIMESTAMPTZ,
  credits_charged BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (job_role_id, candidate_id),
  FOREIGN KEY (job_role_id, org_id) REFERENCES public.job_roles(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id, org_id) REFERENCES public.candidates(id, org_id) ON DELETE CASCADE
);
CREATE INDEX idx_role_candidates_role ON public.role_candidates(job_role_id, stage);
CREATE INDEX idx_role_candidates_candidate ON public.role_candidates(candidate_id);
CREATE TRIGGER audit_role_candidates AFTER INSERT OR UPDATE OF stage, decision OR DELETE ON public.role_candidates
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

CREATE TABLE public.role_candidate_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_candidate_id UUID NOT NULL REFERENCES public.role_candidates(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rc_comments ON public.role_candidate_comments(role_candidate_id, created_at);

-- =============================================
-- 3. Visibility helpers
-- =============================================
-- Staff who may see a job role: org admins and recruiters see all; hiring managers only assigned roles.
CREATE OR REPLACE FUNCTION public.can_view_job_role(_job_role_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.job_roles r
    WHERE r.id = _job_role_id
      AND (public.org_role_of(r.org_id) IN ('org_admin', 'recruiter')
           OR (public.org_role_of(r.org_id) = 'hiring_manager' AND auth.uid() = ANY (r.hiring_manager_ids)))
  )
$$;

-- Staff who may see work done in a context.
CREATE OR REPLACE FUNCTION public.b2b_can_view_context(_org_id UUID, _context_type TEXT, _context_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin() OR CASE
    WHEN _context_type = 'job_role' THEN public.can_view_job_role(_context_id)
    ELSE public.is_org_staff(_org_id) AND public.org_role_of(_org_id) <> 'hiring_manager'
  END
$$;

-- May the subject (student/candidate) see their own results in this context?
-- practice: always; drive: per the drive's release rule; job_role: never (candidates don't see scores).
CREATE OR REPLACE FUNCTION public.b2b_results_visible(_context_type TEXT, _context_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE _context_type
    WHEN 'practice' THEN true
    WHEN 'public_test' THEN true
    WHEN 'drive' THEN EXISTS (SELECT 1 FROM public.drives d WHERE d.id = _context_id
                              AND (d.results_release = 'immediate' OR d.results_released_at IS NOT NULL))
    ELSE false
  END
$$;

-- Program policies (need the helpers above)
ALTER TABLE public.drives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read drives" ON public.drives FOR SELECT TO authenticated USING (
  public.b2b_can_view_context(org_id, 'drive', id)
  OR EXISTS (SELECT 1 FROM public.drive_assignments a
             WHERE a.drive_id = drives.id AND a.student_id IN (SELECT public.my_student_ids()) AND a.status <> 'removed')
);
CREATE POLICY "Editors insert drives" ON public.drives FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_org_editor(org_id));
CREATE POLICY "Editors update drives" ON public.drives FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.is_org_editor(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_editor(org_id));
CREATE POLICY "Editors delete drives" ON public.drives FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.is_org_editor(org_id));

ALTER TABLE public.drive_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read drive assignments" ON public.drive_assignments FOR SELECT TO authenticated USING (
  public.b2b_can_view_context(org_id, 'drive', drive_id) OR student_id IN (SELECT public.my_student_ids())
);
CREATE POLICY "Editors manage drive assignments" ON public.drive_assignments FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_org_editor(org_id))
  WITH CHECK (public.is_super_admin() OR public.is_org_editor(org_id));

ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read job roles" ON public.job_roles FOR SELECT TO authenticated USING (public.can_view_job_role(id));
CREATE POLICY "Editors insert job roles" ON public.job_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));
CREATE POLICY "Editors update job roles" ON public.job_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'))
  WITH CHECK (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));
CREATE POLICY "Editors delete job roles" ON public.job_roles FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));

ALTER TABLE public.role_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read role candidates" ON public.role_candidates FOR SELECT TO authenticated
  USING (public.can_view_job_role(job_role_id));
-- Stage moves by recruiters/admins; hiring-manager decisions go through a function.
CREATE POLICY "Editors update role candidates" ON public.role_candidates FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'))
  WITH CHECK (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));

ALTER TABLE public.role_candidate_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read comments" ON public.role_candidate_comments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.role_candidates rc WHERE rc.id = role_candidate_id AND public.can_view_job_role(rc.job_role_id))
);
CREATE POLICY "Write own comments" ON public.role_candidate_comments FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.role_candidates rc WHERE rc.id = role_candidate_id AND rc.org_id = role_candidate_comments.org_id
      AND public.can_view_job_role(rc.job_role_id))
);
CREATE POLICY "Delete own comments" ON public.role_candidate_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- Candidates (table from the people migration)
CREATE POLICY "Read candidates" ON public.candidates FOR SELECT TO authenticated USING (
  public.is_super_admin() OR user_id = auth.uid()
  OR public.org_role_of(org_id) IN ('org_admin', 'recruiter')
  OR EXISTS (SELECT 1 FROM public.role_candidates rc WHERE rc.candidate_id = candidates.id AND public.can_view_job_role(rc.job_role_id))
);
CREATE POLICY "Editors insert candidates" ON public.candidates FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));
CREATE POLICY "Editors update candidates" ON public.candidates FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'))
  WITH CHECK (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));
CREATE POLICY "Editors delete candidates" ON public.candidates FOR DELETE TO authenticated
  USING (public.is_super_admin() OR public.org_role_of(org_id) IN ('org_admin', 'recruiter'));

-- =============================================
-- 4. Attempts
-- =============================================
CREATE TABLE public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL,
  subject_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN ('practice', 'drive', 'job_role')),
  context_id UUID,               -- drive id / job role id; NULL for practice
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'expired', 'terminated')),
  started_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,       -- server-authoritative
  paused_at TIMESTAMPTZ,         -- maximum policy pause (timer optionally stopped)
  paused_ms BIGINT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('submitted', 'deadline', 'violations', 'staff_ended', 'abandoned')),
  question_set JSONB NOT NULL DEFAULT '[]'::jsonb,   -- per-subject selection, order and option shuffle
  score NUMERIC(8, 2),
  max_score NUMERIC(8, 2),
  section_scores JSONB,
  active_session_id UUID,        -- one live tab/device; a second one is refused and logged
  active_session_seen_at TIMESTAMPTZ,
  accommodations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (assessment_id, org_id) REFERENCES public.assessments(id, org_id) ON DELETE CASCADE,
  CHECK ((student_id IS NULL) OR (candidate_id IS NULL)),
  CHECK (context_type = 'practice' OR context_id IS NOT NULL)
);
CREATE INDEX idx_attempts_subject ON public.attempts(subject_user_id, status);
CREATE INDEX idx_attempts_context ON public.attempts(org_id, context_type, context_id);
CREATE INDEX idx_attempts_assessment ON public.attempts(assessment_id);
-- One attempt per subject per drive / job role.
CREATE UNIQUE INDEX idx_attempts_one_per_context ON public.attempts(subject_user_id, context_type, context_id)
  WHERE context_type <> 'practice';
CREATE TRIGGER update_attempts_updated_at BEFORE UPDATE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.drive_assignments
  ADD CONSTRAINT drive_assignments_attempt_fk FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON DELETE SET NULL;
ALTER TABLE public.role_candidates
  ADD CONSTRAINT role_candidates_attempt_fk FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON DELETE SET NULL;

-- Latest autosaved answer per question (written every ~5 s and on blur).
CREATE TABLE public.attempt_answers (
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  language TEXT,
  code TEXT CHECK (code IS NULL OR length(code) <= 100000),
  mcq_choice JSONB,
  seq INTEGER NOT NULL DEFAULT 0,   -- client save counter: older saves never overwrite newer ones
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

-- Graded runs (sample runs and final submissions).
CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('run', 'submit', 'final')),
  language TEXT,
  code TEXT CHECK (code IS NULL OR length(code) <= 100000),
  mcq_choice JSONB,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  -- per test: { test_id, sample, passed, time_ms, memory_kb, status } (hidden tests never include inputs/outputs)
  results JSONB,
  compile_output TEXT,
  passed INTEGER,
  total INTEGER,
  score NUMERIC(8, 2),
  max_score NUMERIC(8, 2),
  quality_review JSONB,          -- optional AI code-quality review, a separate dimension
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  judged_at TIMESTAMPTZ
);
CREATE INDEX idx_submissions_attempt ON public.submissions(attempt_id, question_id, created_at);
CREATE INDEX idx_submissions_question ON public.submissions(question_id, kind);

-- Compact keystroke/diff log for replay and integrity signals (logged from day one; replay UI later).
CREATE TABLE public.edit_history (
  id BIGSERIAL PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  -- [{ t: ms since attempt start, op: "ins"|"del"|"paste_blocked"|"lang", at, text?, len? }]
  events JSONB NOT NULL CHECK (jsonb_typeof(events) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id, seq)
);

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read attempts" ON public.attempts FOR SELECT TO authenticated USING (
  public.b2b_can_view_context(org_id, context_type, context_id)
  OR (subject_user_id = auth.uid() AND public.b2b_results_visible(context_type, context_id))
);
-- How the caller relates to an attempt, bypassing attempts' own RLS (which hides unreleased attempts
-- from their subject): 'staff' (may view the context), 'subject_visible' (own, results visible),
-- 'subject' (own, results not visible yet), or NULL.
CREATE OR REPLACE FUNCTION public.b2b_attempt_access(_attempt_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN public.b2b_can_view_context(a.org_id, a.context_type, a.context_id) THEN 'staff'
    WHEN a.subject_user_id = auth.uid() AND public.b2b_results_visible(a.context_type, a.context_id) THEN 'subject_visible'
    WHEN a.subject_user_id = auth.uid() THEN 'subject'
  END
  FROM public.attempts a WHERE a.id = _attempt_id
$$;

ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read attempt answers" ON public.attempt_answers FOR SELECT TO authenticated
  USING (public.b2b_attempt_access(attempt_id) IS NOT NULL);
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
-- Subjects always see their own sample runs; graded submissions only once results are visible.
CREATE POLICY "Read submissions" ON public.submissions FOR SELECT TO authenticated USING (
  public.b2b_attempt_access(attempt_id) IN ('staff', 'subject_visible')
  OR (kind = 'run' AND public.b2b_attempt_access(attempt_id) = 'subject')
);
ALTER TABLE public.edit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read edit history" ON public.edit_history FOR SELECT TO authenticated
  USING (public.b2b_attempt_access(attempt_id) = 'staff');

-- =============================================
-- 5. Interviews: drive / job-role context, code walkthrough, candidates
-- =============================================
ALTER TABLE public.b2b_interviews DROP CONSTRAINT IF EXISTS b2b_interviews_kind_check;
ALTER TABLE public.b2b_interviews
  ADD CONSTRAINT b2b_interviews_kind_check CHECK (kind IN ('practice', 'public_test', 'drive', 'job_role')),
  ADD COLUMN context_id UUID,                              -- drive id / job role id
  ADD COLUMN attempt_id UUID REFERENCES public.attempts(id) ON DELETE SET NULL,   -- code walkthrough source
  ADD COLUMN candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  ADD COLUMN student_id UUID REFERENCES public.students(id) ON DELETE SET NULL;
CREATE INDEX idx_b2b_interviews_context ON public.b2b_interviews(org_id, kind, context_id);

ALTER TABLE public.drive_assignments
  ADD CONSTRAINT drive_assignments_interview_fk FOREIGN KEY (interview_id) REFERENCES public.b2b_interviews(id) ON DELETE SET NULL;
ALTER TABLE public.role_candidates
  ADD CONSTRAINT role_candidates_interview_fk FOREIGN KEY (interview_id) REFERENCES public.b2b_interviews(id) ON DELETE SET NULL;

-- Owners see drive / job-role interview scores only when results are visible; staff per context.
DROP POLICY "Read interviews" ON public.b2b_interviews;
CREATE POLICY "Read interviews" ON public.b2b_interviews FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.b2b_can_view_context(org_id, kind, context_id)
);
DROP POLICY "Read evaluations" ON public.b2b_evaluations;
CREATE POLICY "Read evaluations" ON public.b2b_evaluations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.b2b_interviews i WHERE i.id = interview_id
          AND (public.b2b_can_view_context(i.org_id, i.kind, i.context_id)
               OR (i.user_id = auth.uid() AND public.b2b_results_visible(i.kind, i.context_id))))
);

-- =============================================
-- 6. Proctoring
-- =============================================
CREATE TABLE public.proctoring_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN ('practice', 'drive', 'job_role')),
  context_id UUID,
  attempt_id UUID REFERENCES public.attempts(id) ON DELETE CASCADE,
  interview_id UUID REFERENCES public.b2b_interviews(id) ON DELETE CASCADE,
  policy TEXT NOT NULL CHECK (policy IN ('off', 'standard', 'strict', 'maximum')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  -- { browser, version, camera, mic, screen: 'monitor', displays, bandwidth_kbps, cores, memory_gb, tier }
  system_check JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  violations INTEGER NOT NULL DEFAULT 0,     -- hard violations (strict / maximum policies)
  integrity_score NUMERIC(5, 2) CHECK (integrity_score IS NULL OR integrity_score BETWEEN 0 AND 100),
  integrity_band TEXT CHECK (integrity_band IS NULL OR integrity_band IN ('high', 'medium', 'low')),
  score_detail JSONB,            -- how the score was computed (per signal type, with caps)
  CHECK (attempt_id IS NOT NULL OR interview_id IS NOT NULL)
);
CREATE INDEX idx_proctoring_sessions_attempt ON public.proctoring_sessions(attempt_id);
CREATE INDEX idx_proctoring_sessions_interview ON public.proctoring_sessions(interview_id);
CREATE INDEX idx_proctoring_sessions_context ON public.proctoring_sessions(org_id, context_type, context_id);

CREATE TABLE public.proctoring_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.proctoring_sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type ~ '^[a-z_]{3,40}$'),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  evidence_path TEXT,            -- private bucket path, org-scoped
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'dismissed')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 2000),
  client_event_id UUID,          -- idempotent batched inserts
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX idx_proctoring_events_org_session_time ON public.proctoring_events(org_id, session_id, started_at);
CREATE UNIQUE INDEX idx_proctoring_events_client ON public.proctoring_events(session_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE TABLE public.integrity_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.proctoring_sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- the human decision, stored separately from the AI integrity score
  decision TEXT NOT NULL CHECK (decision IN ('no_concern', 'minor_concern', 'serious_concern')),
  note TEXT CHECK (note IS NULL OR length(note) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_integrity_reviews_session ON public.integrity_reviews(session_id, created_at DESC);
CREATE TRIGGER audit_integrity_reviews AFTER INSERT ON public.integrity_reviews
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();

ALTER TABLE public.proctoring_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read proctoring sessions" ON public.proctoring_sessions FOR SELECT TO authenticated
  USING (public.b2b_can_view_context(org_id, context_type, context_id));
ALTER TABLE public.proctoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read proctoring events" ON public.proctoring_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.proctoring_sessions s WHERE s.id = session_id
          AND public.b2b_can_view_context(s.org_id, s.context_type, s.context_id))
);
ALTER TABLE public.integrity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read integrity reviews" ON public.integrity_reviews FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.proctoring_sessions s WHERE s.id = session_id
          AND public.b2b_can_view_context(s.org_id, s.context_type, s.context_id))
);
CREATE POLICY "Staff write integrity reviews" ON public.integrity_reviews FOR INSERT TO authenticated WITH CHECK (
  reviewer_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.proctoring_sessions s WHERE s.id = session_id AND s.org_id = integrity_reviews.org_id
      AND public.b2b_can_view_context(s.org_id, s.context_type, s.context_id))
);

-- =============================================
-- 7. Analytics: one competency model across tests, interviews and resumes
-- =============================================
CREATE TABLE public.competency_dimensions (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]{3,40}$'),
  label TEXT NOT NULL,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO public.competency_dimensions (key, label, sort) VALUES
  ('coding', 'Coding', 10),
  ('problem_solving', 'Problem solving', 20),
  ('technical_knowledge', 'Technical knowledge', 30),
  ('communication', 'Communication', 40),
  ('clarity_confidence', 'Clarity and confidence', 50),
  ('resume_quality', 'Resume quality', 60),
  ('integrity', 'Integrity', 70);

CREATE TABLE public.dimension_scores (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('assessment', 'interview', 'resume', 'proctoring')),
  source_id UUID NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('practice', 'drive', 'job_role')),
  context_id UUID,
  dimension TEXT NOT NULL REFERENCES public.competency_dimensions(key),
  topic TEXT,                    -- for technical_knowledge per topic
  score NUMERIC(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, dimension, topic)
);
CREATE INDEX idx_dimension_scores_org ON public.dimension_scores(org_id, dimension, created_at);
CREATE INDEX idx_dimension_scores_student ON public.dimension_scores(student_id);
CREATE INDEX idx_dimension_scores_context ON public.dimension_scores(org_id, context_type, context_id);

ALTER TABLE public.competency_dimensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read dimensions" ON public.competency_dimensions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super-admin writes dimensions" ON public.competency_dimensions FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
ALTER TABLE public.dimension_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read dimension scores" ON public.dimension_scores FOR SELECT TO authenticated USING (
  public.b2b_can_view_context(org_id, context_type, context_id)
  OR (subject_user_id = auth.uid() AND public.b2b_results_visible(context_type, context_id))
);

-- =============================================
-- 8. Sharing + resume links
-- =============================================
CREATE TABLE public.share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('candidate_report')),
  target_id UUID NOT NULL,       -- role_candidates.id
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);
CREATE INDEX idx_share_links_target ON public.share_links(target_id);
CREATE TRIGGER audit_share_links AFTER INSERT OR UPDATE OF revoked_at ON public.share_links
  FOR EACH ROW EXECUTE FUNCTION public.b2b_audit_row();
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read share links" ON public.share_links FOR SELECT TO authenticated USING (
  public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.role_candidates rc WHERE rc.id = target_id AND rc.org_id = share_links.org_id
      AND public.can_view_job_role(rc.job_role_id))
);
CREATE POLICY "Revoke share links" ON public.share_links FOR UPDATE TO authenticated
  USING (public.org_role_of(org_id) IN ('org_admin', 'recruiter') OR created_by = auth.uid())
  WITH CHECK (public.org_role_of(org_id) IN ('org_admin', 'recruiter') OR created_by = auth.uid());
-- Created by a service-role function (it hashes the token); resolved publicly only by an edge function.

-- A student's B2C resume analyses linked to the college (B2C tables are not altered; no FK on purpose).
CREATE TABLE public.org_resume_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_analysis_id UUID NOT NULL,    -- public.resume_analyses.id
  drive_id UUID REFERENCES public.drives(id) ON DELETE SET NULL,
  ats_score NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, resume_analysis_id)
);
CREATE INDEX idx_org_resume_links_student ON public.org_resume_links(student_id, created_at DESC);
ALTER TABLE public.org_resume_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read resume links" ON public.org_resume_links FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.b2b_can_view_context(org_id, 'drive', drive_id)
);

-- =============================================
-- Grants
-- =============================================
REVOKE EXECUTE ON FUNCTION public.is_any_org_editor(), public.can_edit_question(UUID), public.can_view_job_role(UUID),
  public.b2b_can_view_context(UUID, TEXT, UUID), public.b2b_results_visible(TEXT, UUID), public.b2b_attempt_access(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_any_org_editor(), public.can_edit_question(UUID), public.can_view_job_role(UUID),
  public.b2b_can_view_context(UUID, TEXT, UUID), public.b2b_results_visible(TEXT, UUID), public.b2b_attempt_access(UUID)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.questions_verify_guard() FROM PUBLIC, anon, authenticated;
