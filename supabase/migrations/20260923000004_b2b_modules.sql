-- B2B interview modules.
-- A module is a JSON spec:
--   { name, type: skill|company_pack|hr, description?, topics[], pass_threshold (0-10),
--     max_turns, max_minutes, style_notes? }
-- org_id NULL = global template in the HiResume library (super-admin managed).
-- Orgs enable a template by copying it into an org-owned module they can then edit.
-- The same rules live in supabase/functions/_shared/module-spec.ts (UI + engine);
-- the CHECK below is the backstop.

CREATE OR REPLACE FUNCTION public.b2b_valid_module_spec(s JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  t JSONB;
  n INTEGER;
BEGIN
  IF jsonb_typeof(s) <> 'object' THEN RETURN false; END IF;
  IF jsonb_typeof(s->'name') <> 'string' OR length(btrim(s->>'name')) NOT BETWEEN 2 AND 80 THEN RETURN false; END IF;
  IF coalesce(s->>'type', '') NOT IN ('skill', 'company_pack', 'hr') THEN RETURN false; END IF;
  IF s ? 'description' AND (jsonb_typeof(s->'description') <> 'string' OR length(s->>'description') > 300) THEN RETURN false; END IF;
  IF s ? 'style_notes' AND (jsonb_typeof(s->'style_notes') <> 'string' OR length(s->>'style_notes') > 2000) THEN RETURN false; END IF;

  IF jsonb_typeof(s->'topics') <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(s->'topics');
  IF n NOT BETWEEN 1 AND 15 THEN RETURN false; END IF;
  FOR t IN SELECT * FROM jsonb_array_elements(s->'topics') LOOP
    IF jsonb_typeof(t) <> 'string' OR length(btrim(t #>> '{}')) NOT BETWEEN 2 AND 80 THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(btrim(x))) FROM jsonb_array_elements_text(s->'topics') x) <> n THEN RETURN false; END IF;

  IF jsonb_typeof(s->'pass_threshold') <> 'number' OR (s->>'pass_threshold')::numeric NOT BETWEEN 0 AND 10 THEN RETURN false; END IF;
  IF jsonb_typeof(s->'max_turns') <> 'number' OR (s->>'max_turns')::numeric NOT BETWEEN 3 AND 30
     OR (s->>'max_turns')::numeric <> trunc((s->>'max_turns')::numeric) THEN RETURN false; END IF;
  IF jsonb_typeof(s->'max_minutes') <> 'number' OR (s->>'max_minutes')::numeric NOT BETWEEN 3 AND 60
     OR (s->>'max_minutes')::numeric <> trunc((s->>'max_minutes')::numeric) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE TABLE public.interview_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = library template
  spec JSONB NOT NULL CHECK (public.b2b_valid_module_spec(spec)),
  name TEXT GENERATED ALWAYS AS (spec->>'name') STORED,
  type TEXT GENERATED ALWAYS AS (spec->>'type') STORED,
  is_active BOOLEAN NOT NULL DEFAULT true,       -- archived modules stay for historical interviews
  template_id UUID REFERENCES public.interview_modules(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,             -- bumped on every spec change; interviews snapshot it
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interview_modules_org ON public.interview_modules(org_id, is_active);
CREATE UNIQUE INDEX idx_interview_modules_org_name ON public.interview_modules(org_id, lower(name)) WHERE org_id IS NOT NULL AND is_active;
CREATE UNIQUE INDEX idx_interview_modules_template_name ON public.interview_modules(lower(name)) WHERE org_id IS NULL;

CREATE OR REPLACE FUNCTION public.interview_modules_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_packs BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'interview_modules.org_id is immutable';
    END IF;
    IF NEW.spec IS DISTINCT FROM OLD.spec THEN
      NEW.version := OLD.version + 1;
    ELSE
      NEW.version := OLD.version;
    END IF;
    NEW.updated_at := now();
  END IF;

  -- Company packs only on plans that include them (checked when a pack is created, re-typed or re-activated).
  IF NEW.org_id IS NOT NULL AND NEW.spec->>'type' = 'company_pack' AND NEW.is_active
     AND (TG_OP = 'INSERT' OR OLD.spec->>'type' <> 'company_pack' OR NOT OLD.is_active) THEN
    SELECT p.company_packs_enabled INTO v_packs
      FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id WHERE o.id = NEW.org_id;
    IF NOT coalesce(v_packs, false) THEN
      RAISE EXCEPTION 'PLAN_FEATURE: company packs are not included in this plan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER interview_modules_before_write
  BEFORE INSERT OR UPDATE ON public.interview_modules
  FOR EACH ROW EXECUTE FUNCTION public.interview_modules_before_write();

-- =============================================
-- RLS
-- =============================================
CREATE OR REPLACE FUNCTION public.has_any_org_membership()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_memberships WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.org_has_company_packs(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT p.company_packs_enabled FROM public.organizations o
                   JOIN public.plans p ON p.id = o.plan_id WHERE o.id = _org_id), false)
$$;

REVOKE EXECUTE ON FUNCTION public.has_any_org_membership(), public.org_has_company_packs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_org_membership(), public.org_has_company_packs(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.interview_modules_before_write() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.interview_modules ENABLE ROW LEVEL SECURITY;

-- Library templates: visible to anyone in an institution (not to plain B2C users).
-- Org modules: staff see all (incl. archived); students see active ones their plan allows.
CREATE POLICY "Read modules" ON public.interview_modules
  FOR SELECT TO authenticated USING (
    public.is_super_admin()
    OR (org_id IS NULL AND public.has_any_org_membership())
    OR (org_id IS NOT NULL AND public.is_org_staff(org_id))
    OR (org_id IS NOT NULL AND is_active AND public.is_org_member(org_id)
        AND (type <> 'company_pack' OR public.org_has_company_packs(org_id)))
  );
CREATE POLICY "Write org modules" ON public.interview_modules
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin() OR (org_id IS NOT NULL AND public.is_org_admin(org_id))
  );
CREATE POLICY "Update org modules" ON public.interview_modules
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (org_id IS NOT NULL AND public.is_org_admin(org_id)))
  WITH CHECK (public.is_super_admin() OR (org_id IS NOT NULL AND public.is_org_admin(org_id)));
CREATE POLICY "Delete org modules" ON public.interview_modules
  FOR DELETE TO authenticated USING (
    public.is_super_admin() OR (org_id IS NOT NULL AND public.is_org_admin(org_id))
  );

-- =============================================
-- Library seed. Company packs are *style practice* modelled on commonly reported
-- fresher interview patterns; they are not official and not affiliated with the companies.
-- =============================================
INSERT INTO public.interview_modules (org_id, spec) VALUES
(NULL, $j${
  "name": "Java Fundamentals", "type": "skill",
  "description": "Core Java and OOP at fresher depth.",
  "topics": ["JDK, JRE and JVM", "Data types, operators and control flow", "Classes, objects and constructors",
             "Inheritance and polymorphism", "Abstraction and interfaces", "Encapsulation and access modifiers",
             "Strings and StringBuilder", "Arrays", "Exception handling", "static and final keywords"],
  "pass_threshold": 6, "max_turns": 12, "max_minutes": 15,
  "style_notes": "Fresher level. Ask the student to explain concepts in their own words and give a small real-world example. You may describe a 2-3 line snippet and ask what it prints or why it fails; never ask them to dictate long code. Prefer 'why' and 'what happens if' follow-ups over definitions."
}$j$::jsonb),
(NULL, $j${
  "name": "Advanced Java", "type": "skill",
  "description": "Collections, concurrency and modern Java.",
  "topics": ["Collections framework: List, Set, Map", "HashMap internals", "equals and hashCode contract", "Generics",
             "Lambdas and the Streams API", "Threads and synchronization", "Immutability", "Garbage collection basics",
             "JDBC basics", "Serialization"],
  "pass_threshold": 6, "max_turns": 12, "max_minutes": 18,
  "style_notes": "Final-year student who already knows core Java. Probe trade-offs (ArrayList vs LinkedList, HashMap vs TreeMap, synchronized vs concurrent collections). Ask how they would use a concept in a small project. No long code dictation."
}$j$::jsonb),
(NULL, $j${
  "name": "Python Fundamentals", "type": "skill",
  "description": "Core Python for freshers.",
  "topics": ["Data types and mutability", "Lists, tuples, sets and dictionaries", "Control flow and comprehensions",
             "Functions, *args and **kwargs", "OOP in Python", "Exception handling", "Modules and packages",
             "String manipulation", "File handling", "Iterators and generators"],
  "pass_threshold": 6, "max_turns": 12, "max_minutes": 15,
  "style_notes": "Fresher level. Ask for explanations with small examples; you may describe a one-line expression and ask its result. Check understanding of mutability and references with follow-ups."
}$j$::jsonb),
(NULL, $j${
  "name": "SQL", "type": "skill",
  "description": "Relational databases and writing queries.",
  "topics": ["DDL, DML and DCL", "Primary, foreign and unique keys", "Filtering and sorting: WHERE, ORDER BY",
             "Aggregates with GROUP BY and HAVING", "Joins: inner, left, right, full", "Subqueries",
             "Normalization up to 3NF", "Indexes", "Transactions and ACID", "Views"],
  "pass_threshold": 6, "max_turns": 12, "max_minutes": 15,
  "style_notes": "Describe a small table (e.g. employees with id, name, dept, salary) and ask the student to say the query aloud: second highest salary, employees per department, departments with no employees. Accept minor syntax slips in speech; judge the logic."
}$j$::jsonb),
(NULL, $j${
  "name": "DSA Basics", "type": "skill",
  "description": "Data structures and problem-solving approach.",
  "topics": ["Time and space complexity", "Arrays and strings", "Linked lists", "Stacks and queues", "Hashing",
             "Recursion", "Linear and binary search", "Sorting algorithms", "Trees and binary search trees",
             "Graph traversal: BFS and DFS"],
  "pass_threshold": 6, "max_turns": 12, "max_minutes": 18,
  "style_notes": "Ask for the approach and complexity, not code. Use small classic problems (reverse a string, find duplicates, check balanced brackets, find the middle of a linked list). If the approach is brute force, ask whether it can be improved."
}$j$::jsonb),
(NULL, $j${
  "name": "HR / Behavioral", "type": "hr",
  "description": "Self-introduction, projects and behavioural questions.",
  "topics": ["Self introduction", "Strengths and weaknesses", "Final-year project and your role", "Teamwork and conflict",
             "Handling pressure or failure", "Career goals", "Relocation and shift flexibility", "Questions for the interviewer"],
  "pass_threshold": 6, "max_turns": 10, "max_minutes": 12,
  "style_notes": "Warm but professional campus HR tone. Push for specific examples (situation, action, result) instead of generic answers. Judge clarity, structure and honesty, not accent."
}$j$::jsonb),
(NULL, $j${
  "name": "TCS-style fresher round (practice)", "type": "company_pack",
  "description": "Unofficial practice modelled on commonly reported TCS fresher interviews. Not affiliated with TCS.",
  "topics": ["Self introduction", "Final-year project", "Programming fundamentals in your main language", "OOP concepts",
             "DBMS and SQL basics", "Operating system basics", "Computer networks basics",
             "Managerial: situation-based questions", "HR: relocation, shifts and service agreement", "Motivation for joining a service company"],
  "pass_threshold": 6, "max_turns": 14, "max_minutes": 20,
  "style_notes": "One combined conversation covering technical, managerial and HR parts, as commonly reported for TCS fresher hiring: roughly 60% technical at fundamentals depth, 20% situational, 20% HR. Start from the self introduction and project, then fundamentals in the language the student names. Do not claim to represent TCS."
}$j$::jsonb),
(NULL, $j${
  "name": "Infosys-style fresher round (practice)", "type": "company_pack",
  "description": "Unofficial practice modelled on commonly reported Infosys fresher interviews. Not affiliated with Infosys.",
  "topics": ["Self introduction", "Final-year project deep dive", "OOP concepts with examples", "Java or Python fundamentals",
             "DBMS concepts", "SQL queries", "Arrays, strings and sorting", "Logical reasoning puzzle",
             "HR: learning agility and relocation", "Motivation for joining a service company"],
  "pass_threshold": 6, "max_turns": 14, "max_minutes": 20,
  "style_notes": "Technical-heavy (about 70% technical, 30% HR). Expect a simple SQL query or logic question spoken aloud and one short reasoning puzzle. Dig into the project: design choices, the student's own contribution, what they would improve. Do not claim to represent Infosys."
}$j$::jsonb),
(NULL, $j${
  "name": "Wipro-style fresher round (practice)", "type": "company_pack",
  "description": "Unofficial practice modelled on commonly reported Wipro fresher interviews. Not affiliated with Wipro.",
  "topics": ["Self introduction", "Final-year project", "C or Java programming basics", "OOP concepts", "DBMS and SQL",
             "Operating systems basics", "Networking basics", "SDLC", "HR: flexibility, relocation and service agreement",
             "Motivation for joining a service company"],
  "pass_threshold": 6, "max_turns": 14, "max_minutes": 20,
  "style_notes": "Balanced technical and HR (about 60/40) at fundamentals depth. Ask about pointers or memory basics if the student names C. Include flexibility questions about location and shifts. Do not claim to represent Wipro."
}$j$::jsonb),
(NULL, $j${
  "name": "Accenture-style fresher round (practice)", "type": "company_pack",
  "description": "Unofficial practice modelled on commonly reported Accenture fresher interviews. Not affiliated with Accenture.",
  "topics": ["Self introduction and communication", "Final-year project", "OOP basics", "SQL basics", "SDLC and Agile",
             "Cloud computing basics", "Awareness of AI and automation", "Behavioural: teamwork and client situations",
             "HR: relocation and shifts", "Motivation for joining a consulting company"],
  "pass_threshold": 6, "max_turns": 14, "max_minutes": 20,
  "style_notes": "Communication-focused (about 50% behavioural and HR, 50% light technical). Look for structured, confident answers and client-facing awareness. Technical questions stay conceptual. Do not claim to represent Accenture."
}$j$::jsonb),
(NULL, $j${
  "name": "Cognizant-style fresher round (practice)", "type": "company_pack",
  "description": "Unofficial practice modelled on commonly reported Cognizant fresher interviews. Not affiliated with Cognizant.",
  "topics": ["Self introduction", "Final-year project", "OOP concepts", "Java or Python fundamentals", "DBMS and SQL queries",
             "Data structures basics", "SDLC and testing basics", "HR: relocation and shifts", "Motivation for joining a service company"],
  "pass_threshold": 6, "max_turns": 14, "max_minutes": 20,
  "style_notes": "Technical and HR combined (about 65/35) at fundamentals depth, with one simple SQL query spoken aloud. Ask how testing fits into the SDLC. Do not claim to represent Cognizant."
}$j$::jsonb);
