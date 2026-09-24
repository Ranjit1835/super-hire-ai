// B2B interview evaluation.
//
//   evaluate { interviewId }        student (own) or staff/super-admin → runs or joins the evaluation
//   get      { interviewId }        → latest completed evaluation (or status)
//   sweep    { orgId?, limit? }     super-admin (or x-cron-secret) → evaluates finished interviews that have no
//                                   evaluation at the CURRENT evaluator version (also the re-run after a rubric change)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, handle, json, requireUser, serviceClient, str, uuid } from "../_shared/b2b-http.ts";
import { evaluateInterview } from "../_shared/evaluate-interview.ts";
import { EVALUATOR_PROMPT_VERSION } from "../_shared/evaluator.ts";

type Admin = ReturnType<typeof serviceClient>;

async function authorize(admin: Admin, userId: string, interviewId: string) {
  const { data: iv, error } = await admin.from("b2b_interviews").select("id, org_id, user_id, status").eq("id", interviewId).maybeSingle();
  if (error) throw error;
  if (!iv) throw new HttpError(404, "NOT_FOUND", "Interview not found.");
  if (iv.user_id === userId) return iv;
  const [{ data: m }, { data: r }] = await Promise.all([
    admin.from("org_memberships").select("role").eq("org_id", iv.org_id).eq("user_id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  if (r || (m && m.role !== "student")) return iv;
  throw new HttpError(404, "NOT_FOUND", "Interview not found.");
}

async function latest(admin: Admin, interviewId: string) {
  const { data, error } = await admin
    .from("b2b_evaluations")
    .select("id, interview_id, evaluator_version, status, result, audio_metrics, overall_score, readiness_level, primary_gap, error, completed_at, updated_at")
    .eq("interview_id", interviewId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const current = rows.find((r) => r.evaluator_version === EVALUATOR_PROMPT_VERSION);
  const completed = rows.find((r) => r.status === "completed" && r.evaluator_version === EVALUATOR_PROMPT_VERSION)
    ?? rows.find((r) => r.status === "completed");
  return { current, completed };
}

serve(handle("B2B-EVALUATE", async (req, body) => {
  const action = str(body.action, "action", 20);
  const admin = serviceClient();

  if (action === "sweep") {
    const cronSecret = Deno.env.get("B2B_CRON_SECRET");
    const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (!viaCron) {
      const user = await requireUser(req);
      const { data: r } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!r) throw new HttpError(403, "FORBIDDEN", "Super-admin only.");
    }
    const orgId = body.orgId ? uuid(body.orgId, "orgId") : null;
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const { data, error } = await admin.rpc("b2b_interviews_needing_evaluation", {
      _version: EVALUATOR_PROMPT_VERSION, _org_id: orgId, _limit: limit,
    });
    if (error) throw error;
    const ids = (data as { interview_id: string }[]).map((r) => r.interview_id);
    const run = async () => {
      const counts: Record<string, number> = {};
      // Small pool: evaluation calls are long; don't burst the provider.
      for (let i = 0; i < ids.length; i += 3) {
        const out = await Promise.all(ids.slice(i, i + 3).map((id) => evaluateInterview(admin, id)));
        for (const o of out) counts[o.status] = (counts[o.status] ?? 0) + 1;
      }
      console.log(`[B2B-EVALUATE] sweep version=${EVALUATOR_PROMPT_VERSION} org=${orgId ?? "all"} ${JSON.stringify(counts)}`);
      return counts;
    };
    // pg_cron/pg_net only waits a few seconds: score in the background and reply now.
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (viaCron && rt?.waitUntil) {
      rt.waitUntil(run().catch((e) => console.error("[B2B-EVALUATE] sweep:", (e as Error).message)));
      return json({ version: EVALUATOR_PROMPT_VERSION, queued: ids.length });
    }
    return json({ version: EVALUATOR_PROMPT_VERSION, processed: ids.length, counts: await run() });
  }

  const user = await requireUser(req);
  const interviewId = uuid(body.interviewId, "interviewId");
  const iv = await authorize(admin, user.id, interviewId);

  if (action === "evaluate") {
    if (iv.status === "in_progress") throw new HttpError(409, "NOT_FINISHED", "The interview is still in progress.");
    const out = await evaluateInterview(admin, interviewId);
    if (out.status === "skipped") {
      return json({ status: "unavailable", reason: out.reason });
    }
    const { completed } = await latest(admin, interviewId);
    return json({ status: out.status, evaluation: out.status === "completed" ? completed : null, error: out.status === "failed" ? "Scoring failed. We'll retry shortly." : null });
  }

  if (action === "get") {
    const { current, completed } = await latest(admin, interviewId);
    return json({
      status: completed ? "completed" : current?.status ?? (iv.status === "in_progress" ? "in_progress" : "none"),
      evaluation: completed ?? null,
    });
  }

  throw new HttpError(400, "BAD_REQUEST", "Unknown action");
}));
