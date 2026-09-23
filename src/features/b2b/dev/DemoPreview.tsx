// DEV-ONLY visual preview of the institution dashboard with the generated demo data,
// rendered entirely in memory (no Supabase). Mounted at /dev/b2b-demo only when
// import.meta.env.DEV — never part of a production build route.
import { useMemo } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateDemo } from "../../../../scripts/demo-lib";
import { B2BShell } from "../components/B2BShell";
import { OrgContext } from "../components/OrgContext";
import OrgDashboard from "../pages/OrgDashboard";
import StudentDetail from "../pages/StudentDetail";
import type { DashEval } from "../lib/dashboard";
import type { Organization } from "../types";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

export default function DemoPreview() {
  const location = useLocation();
  const { client, org } = useMemo(() => {
    const d = generateDemo({ seed: 2026 });
    const org: Organization = {
      id: ORG_ID, name: d.org.name, slug: d.org.slug, type: "college", logo_url: null, is_demo: true,
      plan_id: "pilot", plan_starts_at: d.org.plan_starts_at, plan_ends_at: d.org.plan_ends_at, created_at: d.org.plan_starts_at,
    };
    const batch = Object.fromEntries(d.batches.map((b) => [b.key, b]));
    const roster = d.students.map((s) => ({
      user_id: s.key, full_name: s.full_name, roll_no: s.roll_no, email: s.email,
      batch_id: s.batch_key, batch_name: batch[s.batch_key].name, department: batch[s.batch_key].department,
    }));
    const evals: DashEval[] = d.interviews.map((iv) => {
      const spec = d.modules.find((m) => m.key === iv.module_key)!.spec;
      const r = iv.evaluation.result;
      return {
        interview_id: iv.key, user_id: iv.student_key, module_id: iv.module_key, module_name: spec.name, module_type: spec.type,
        pass_threshold: spec.pass_threshold, started_at: iv.started_at, completed_at: iv.completed_at,
        overall_score: r.overall_score, readiness_level: r.readiness_level, primary_gap: r.primary_gap,
        dimensions: Object.fromEntries(Object.entries(r.dimensions).map(([k, v]) => [k, typeof v.score === "number" ? v.score : null])),
        per_topic: Object.fromEntries(Object.entries(r.per_topic).map(([k, v]) => [k, typeof v.score === "number" ? v.score : null])),
      };
    });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: true } } });
    client.setQueryData(["b2b", "dashboard", ORG_ID], {
      roster, evals,
      batches: d.batches.map((b) => ({ id: b.key, org_id: ORG_ID, name: b.name, department: b.department, course: b.course, start_date: null })),
    });
    for (const s of d.students) {
      const ivs = d.interviews.filter((i) => i.student_key === s.key);
      client.setQueryData(["b2b", "student-detail", ORG_ID, s.key], {
        student: roster.find((r) => r.user_id === s.key),
        interviews: ivs.map((i) => ({
          id: i.key, module_id: i.module_key, status: "completed", started_at: i.started_at, completed_at: i.completed_at, end_reason: i.end_reason,
          module_spec: d.modules.find((m) => m.key === i.module_key)!.spec,
        })),
        evaluations: new Map(ivs.map((i) => [i.key, {
          id: `e-${i.key}`, interview_id: i.key, evaluator_version: i.evaluation.version, status: "completed",
          result: i.evaluation.result, audio_metrics: i.evaluation.metrics, overall_score: i.evaluation.overall,
          readiness_level: i.evaluation.result.readiness_level, primary_gap: i.evaluation.primary_gap, completed_at: i.completed_at,
        }])),
      });
      for (const i of ivs) client.setQueryData(["b2b", "transcript", i.key], i.turns.map((t) => ({ turn_index: t.turn_index, role: t.role, content: t.content, topic: t.topic, difficulty: t.difficulty })));
    }
    return { client, org };
  }, []);

  return (
    <QueryClientProvider client={client}>
      <OrgContext.Provider value={{ org, role: "org_admin", canManage: true }}>
        <B2BShell title={org.name} subtitle="Dev preview · in-memory demo data" isDemo tabs={[{ to: `/dev/b2b-demo/org/${ORG_ID}/dashboard`, label: "Readiness" }]}>
          <Routes location={location}>
            <Route path="org/:orgId/dashboard" element={<OrgDashboard />} />
            <Route path="org/:orgId/students/:userId" element={<StudentDetail />} />
            <Route path="*" element={<OrgDashboard />} />
          </Routes>
        </B2BShell>
      </OrgContext.Provider>
    </QueryClientProvider>
  );
}
