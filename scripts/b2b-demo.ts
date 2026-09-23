// Demo institution: seed / reset / delete "Demo Engineering College".
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run demo:b2b -- reset [--admin-email you@example.com] [--seed 2026]
//   … npm run demo:b2b -- delete
//   … npm run demo:b2b -- status
//
// • The org is flagged is_demo (banner on every screen, watermarked PDFs, "(DEMO)" Excel sheets).
// • Students are fictional accounts on @demo.hiresume.invalid with random, unstored passwords
//   (nobody can sign in as them). No LLM calls: scores come from the generator, and the
//   evaluation sweep skips demo orgs.
// • Delete/reset go through b2b_demo_reset(), which refuses any org that isn't is_demo and only
//   returns demo-domain accounts for deletion. --admin-email attaches YOUR existing account as the
//   demo's org admin so you can present it from your own login; it is never deleted.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_EMAIL_DOMAIN, DEMO_SLUG, generateDemo } from "./demo-lib.ts";

const [cmd = "status"] = process.argv.slice(2);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function findDemoOrg(): Promise<{ id: string; is_demo: boolean } | null> {
  const { data, error } = await db.from("organizations").select("id, is_demo").eq("slug", DEMO_SLUG).maybeSingle();
  if (error) throw error;
  return data;
}

async function remove(): Promise<void> {
  const org = await findDemoOrg();
  if (!org) { console.log("No demo org to delete."); return; }
  if (!org.is_demo) throw new Error(`Refusing: org with slug ${DEMO_SLUG} is not flagged is_demo.`);
  const users = await must(db.rpc("b2b_demo_reset", { _org_id: org.id }), "reset") as string[];
  let deleted = 0;
  for (const id of users) {
    const { data } = await db.auth.admin.getUserById(id);
    const email = data.user?.email ?? "";
    if (!email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`)) continue; // belt and braces
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.warn(`  could not delete ${email}: ${error.message}`);
    else deleted++;
  }
  console.log(`Deleted demo org and ${deleted} demo accounts.`);
}

async function seed(): Promise<void> {
  if (await findDemoOrg()) throw new Error("Demo org already exists. Use `reset` to recreate it.");
  const seedNo = Number(arg("seed") ?? 2026);
  const d = generateDemo({ seed: seedNo });
  console.log(`Seeding ${d.org.name}: ${d.students.length} students, ${d.interviews.length} interviews (seed ${seedNo})…`);

  const org = await must(db.from("organizations").insert({ ...d.org }).select("id").single(), "org") as { id: string };
  try {
    const batches = await must(db.from("batches")
      .insert(d.batches.map((b) => ({ org_id: org.id, name: b.name, department: b.department, course: b.course })))
      .select("id, name"), "batches") as Array<{ id: string; name: string }>;
    const batchId = Object.fromEntries(d.batches.map((b) => [b.key, batches.find((x) => x.name === b.name)!.id]));

    const modules = await must(db.from("interview_modules")
      .insert(d.modules.map((m) => ({ org_id: org.id, spec: m.spec })))
      .select("id, name, version"), "modules") as Array<{ id: string; name: string; version: number }>;
    const mod = Object.fromEntries(d.modules.map((m) => [m.key, modules.find((x) => x.name === m.spec.name)!]));

    // Fictional accounts: confirmed, random password nobody knows.
    const userId: Record<string, string> = {};
    for (const s of d.students) {
      const { data, error } = await db.auth.admin.createUser({
        email: s.email, password: randomBytes(24).toString("base64url"), email_confirm: true,
        user_metadata: { display_name: s.full_name, demo: true },
      });
      if (error || !data.user) throw new Error(`user ${s.email}: ${error?.message}`);
      userId[s.key] = data.user.id;
    }
    await must(db.from("org_memberships").insert(d.students.map((s) => ({
      org_id: org.id, user_id: userId[s.key], role: "student", batch_id: batchId[s.batch_key],
      full_name: s.full_name, email: s.email, roll_no: s.roll_no,
    }))), "memberships");

    const counts: Record<string, number> = {};
    for (const iv of d.interviews) counts[iv.student_key] = (counts[iv.student_key] ?? 0) + 1;
    await must(db.from("org_student_usage").insert(Object.entries(counts).map(([k, n]) => ({
      org_id: org.id, user_id: userId[k], interviews_used: n,
    }))), "usage");

    // Interviews, turns, evaluations in chunks.
    const ivRows = d.interviews.map((iv) => {
      const m = mod[iv.module_key];
      const spec = d.modules.find((x) => x.key === iv.module_key)!.spec;
      return {
        id: randomUUID(), key: iv.key,
        row: {
          org_id: org.id, user_id: userId[iv.student_key], module_id: m.id, module_version: m.version, module_spec: spec,
          state: { ...iv.state, module_id: m.id }, status: "completed", end_reason: iv.end_reason,
          prompt_version: "demo-seed", client_meta: { browser: "Chrome 140", platform: "Windows", input_mode: "voice", stt_lang: "en-IN", stt_supported: true },
          started_at: iv.started_at, deadline_at: new Date(Date.parse(iv.started_at) + spec.max_minutes * 60_000).toISOString(),
          last_activity_at: iv.completed_at, completed_at: iv.completed_at,
        },
      };
    });
    const idByKey = Object.fromEntries(ivRows.map((r) => [r.key, r.id]));
    for (let i = 0; i < ivRows.length; i += 50) {
      await must(db.from("b2b_interviews").insert(ivRows.slice(i, i + 50).map((r) => ({ id: r.id, ...r.row }))), "interviews");
    }
    const turns = d.interviews.flatMap((iv) => iv.turns.map((t) => ({
      interview_id: idByKey[iv.key], org_id: org.id, turn_index: t.turn_index, role: t.role, content: t.content,
      topic: t.topic, difficulty: t.difficulty, meta: t.meta, client_turn_id: t.role === "student" ? randomUUID() : null,
      created_at: iv.started_at,
    })));
    for (let i = 0; i < turns.length; i += 500) await must(db.from("b2b_interview_turns").insert(turns.slice(i, i + 500)), "turns");
    const evals = d.interviews.map((iv) => ({
      interview_id: idByKey[iv.key], org_id: org.id, user_id: userId[iv.student_key], module_id: mod[iv.module_key].id,
      evaluator_version: iv.evaluation.version, status: "completed", model: "demo-seed",
      result: iv.evaluation.result, audio_metrics: iv.evaluation.metrics, overall_score: iv.evaluation.overall,
      readiness_level: iv.evaluation.readiness, primary_gap: iv.evaluation.primary_gap, attempts: 0, llm_usage: [],
      created_at: iv.completed_at, updated_at: iv.completed_at, completed_at: iv.completed_at,
    }));
    for (let i = 0; i < evals.length; i += 100) await must(db.from("b2b_evaluations").insert(evals.slice(i, i + 100)), "evaluations");

    const adminEmail = arg("admin-email");
    if (adminEmail) {
      const { data, error } = await db.rpc("b2b_email_has_account", { _email: adminEmail });
      if (error || !data) console.warn(`  --admin-email ${adminEmail}: no HiResume account with that email; skipped.`);
      else {
        // Look up the id via the invite helper table-free path: listUsers is paginated, so search by email.
        let found: string | null = null;
        for (let page = 1; page <= 50 && !found; page++) {
          const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
          found = list.users.find((u) => u.email?.toLowerCase() === adminEmail.toLowerCase())?.id ?? null;
          if (list.users.length < 200) break;
        }
        if (found) {
          await must(db.from("org_memberships").insert({ org_id: org.id, user_id: found, role: "org_admin", full_name: "Demo presenter", email: adminEmail }), "admin");
          console.log(`  ${adminEmail} is now org admin of the demo (open /org).`);
        }
      }
    }
    console.log(`Done. Open /org/${org.id}/dashboard (super-admin or --admin-email account).`);
  } catch (e) {
    console.error("Seeding failed; rolling back the partial demo…");
    await remove().catch((e2) => console.error("  cleanup failed:", (e2 as Error).message));
    throw e;
  }
}

async function status(): Promise<void> {
  const org = await findDemoOrg();
  if (!org) { console.log("No demo org."); return; }
  const count = async (t: string) => (await db.from(t).select("*", { count: "exact", head: true }).eq("org_id", org.id)).count ?? 0;
  console.log(`Demo org ${org.id} (is_demo=${org.is_demo}): ${await count("org_memberships")} members, ${await count("b2b_interviews")} interviews, ${await count("b2b_evaluations")} evaluations.`);
}

try {
  if (cmd === "seed") await seed();
  else if (cmd === "reset") { await remove(); await seed(); }
  else if (cmd === "delete") await remove();
  else if (cmd === "status") await status();
  else { console.log("Usage: npm run demo:b2b -- seed|reset|delete|status [--admin-email you@x.com] [--seed 2026]"); process.exit(1); }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
