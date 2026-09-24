// Public readiness test for coaching institutes: /test/{org-slug}.
//
//   start { slug, moduleId, lead: { full_name, phone, email, target_course }, consent: true, clientMeta? }
//     Caller: a Supabase *anonymous* session (or any signed-in user). Validates the lead, applies
//     rate limits and the org's monthly cap (in SQL), creates the lead + a short public-test
//     interview, asks the opening question, and returns { interviewId }. The rest of the test
//     (answer / resume / end) goes through b2b-interview and scoring through b2b-evaluate, exactly
//     like a student interview.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, handle, json, requireUser, serviceClient, sha256Hex, str, uuid } from "../_shared/b2b-http.ts";
import { normalizeModuleSpec } from "../_shared/module-spec.ts";
import { initState } from "../_shared/interview-engine.ts";
import { INTERVIEWER_PROMPT_VERSION } from "../_shared/interview-prompts.ts";
import { askOpeningQuestion, firstNameOf } from "../_shared/interview-opening.ts";
import { sanitizeClientMeta } from "../_shared/interview-meta.ts";
import { PUBLIC_TEST_CONSENT_VERSION, publicTestConsentText, validateLead } from "../_shared/lead.ts";

const REASONS: Record<string, [number, string]> = {
  NOT_AVAILABLE: [404, "This readiness test isn't available right now."],
  MODULE_UNAVAILABLE: [404, "That test is no longer offered. Please pick another."],
  MODULE_CHANGED: [409, "This test was just updated. Please try again."],
  CONSENT_REQUIRED: [400, "Please accept the consent to continue."],
  IN_PROGRESS: [409, "You already have a test in progress in this browser."],
  MONTHLY_CAP: [429, "Free tests for this month are fully booked. Please contact the institute directly."],
  ALREADY_TAKEN: [429, "You've already taken this test recently. Please contact the institute for your results or a follow-up."],
  RATE_LIMITED: [429, "Too many tests from this network today. Please try again tomorrow."],
};

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff?.split(",")[0] ?? req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "").trim();
  return ip || null;
}

serve(handle("B2B-PUBLIC-TEST", async (req, body) => {
  const action = str(body.action, "action", 20);
  if (action !== "start") throw new HttpError(400, "BAD_REQUEST", "Unknown action");

  const user = await requireUser(req); // anonymous session is fine
  const admin = serviceClient();
  const slug = str(body.slug, "slug", 60).toLowerCase();
  const moduleId = uuid(body.moduleId, "moduleId");
  if (body.consent !== true) throw new HttpError(400, "CONSENT_REQUIRED", REASONS.CONSENT_REQUIRED[1]);
  const { lead, errors } = validateLead((body.lead ?? {}) as Record<string, string>);
  if (!lead) throw new HttpError(400, "INVALID_LEAD", Object.values(errors).join(". "));

  const { data: org, error: orgErr } = await admin.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
  if (orgErr) throw orgErr;
  if (!org) throw new HttpError(404, "NOT_AVAILABLE", REASONS.NOT_AVAILABLE[1]);
  const { data: mod, error: modErr } = await admin.from("interview_modules")
    .select("id, org_id, spec, version").eq("id", moduleId).eq("org_id", org.id).maybeSingle();
  if (modErr) throw modErr;
  if (!mod) throw new HttpError(404, "MODULE_UNAVAILABLE", REASONS.MODULE_UNAVAILABLE[1]);
  const { spec } = normalizeModuleSpec(mod.spec);
  if (!spec) throw new Error(`module ${moduleId} has an invalid spec`);

  // Salted hashes: rate limits work without storing extra copies of contact details.
  const salt = Deno.env.get("B2B_HASH_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ip = clientIp(req);
  const [phoneHash, emailHash, ipHash] = await Promise.all([
    sha256Hex(`${salt}:phone:${lead.phone}`), sha256Hex(`${salt}:email:${lead.email}`), ip ? sha256Hex(`${salt}:ip:${ip}`) : Promise.resolve(null),
  ]);

  const { data, error } = await admin.rpc("b2b_start_public_test", {
    _user_id: user.id, _slug: slug, _module_id: moduleId, _module_version: mod.version,
    _initial_state: initState(moduleId, { ...spec, max_turns: Math.min(spec.max_turns, 6), max_minutes: Math.min(spec.max_minutes, 10) }),
    _prompt_version: INTERVIEWER_PROMPT_VERSION,
    _full_name: lead.full_name, _phone: lead.phone, _email: lead.email, _target_course: lead.target_course,
    _phone_hash: phoneHash, _email_hash: emailHash, _ip_hash: ipHash,
    _consent_version: PUBLIC_TEST_CONSENT_VERSION, _consent_text: publicTestConsentText(org.name),
    _client_meta: sanitizeClientMeta(body.clientMeta),
  });
  if (error) throw error;
  const r = data as { ok: boolean; reason?: string; interview_id?: string };
  if (!r.ok) {
    const [status, msg] = REASONS[r.reason ?? ""] ?? [400, "Could not start the test."];
    throw new HttpError(status, r.reason ?? "START_FAILED", msg);
  }

  const { data: iv } = await admin.from("b2b_interviews").select("id, module_spec, state").eq("id", r.interview_id!).single();
  try {
    const o = await askOpeningQuestion(iv!.module_spec, firstNameOf(lead.full_name));
    const { error: recErr } = await admin.rpc("b2b_record_opening", {
      _interview_id: iv!.id, _question: o.question,
      _meta: { llm: [o.usage], prompt_version: INTERVIEWER_PROMPT_VERSION }, _state: iv!.state,
    });
    if (recErr) throw recErr;
  } catch (e) {
    console.error("[B2B-PUBLIC-TEST] opening failed:", (e as Error).message);
    await admin.rpc("b2b_public_test_failed_start", { _interview_id: iv!.id });
    throw new HttpError(503, "AI_BUSY", "The interviewer is busy right now. Please try again in a minute — this attempt won't count.");
  }

  console.log(`[B2B-PUBLIC-TEST] start org=${org.id} interview=${iv!.id}`);
  return json({ interviewId: iv!.id });
}));
