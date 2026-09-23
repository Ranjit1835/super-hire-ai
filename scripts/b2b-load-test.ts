// B2B interview load test — simulates a college lab of N students interviewing at once.
//
//   STAGING_SUPABASE_URL=… STAGING_SUPABASE_ANON_KEY=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
//   node scripts/b2b-load-test.ts --students 60 --answers 4 --ramp 20
//
// Options: --students N (60)  --answers K per student (4)  --ramp S seconds to start everyone (20; 0 = burst)
//          --think MIN-MAX seconds between answers (4-10)  --keep (don't delete test data)
//
// Requires the B2B migrations and the b2b-interview function deployed to the STAGING project.
// Uses real LLM calls (≈ students × (answers + 1) calls). Refuses to run against production.
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "zhfahrrxuguagwbujkiz";
const URL = process.env.STAGING_SUPABASE_URL ?? "";
const ANON = process.env.STAGING_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL || !ANON || !SERVICE) {
  console.error("Set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY and STAGING_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (URL.includes(PRODUCTION_REF)) {
  console.error("Refusing to load-test the production project.");
  process.exit(1);
}

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
};
const STUDENTS = Number(arg("students", "60"));
const ANSWERS = Number(arg("answers", "4"));
const RAMP_S = Number(arg("ramp", "20"));
const [THINK_MIN, THINK_MAX] = arg("think", "4-10").split("-").map(Number);
const KEEP = process.argv.includes("--keep");
const RUN = Date.now().toString(36);

const ANSWERS_POOL = [
  "An inner join returns only the rows that have matching values in both tables, for example employees and departments on department id.",
  "A left join keeps every row from the left table and fills nulls where there is no match on the right side.",
  "I think an index is like the index of a book, it helps the database find rows faster but it slows down inserts a little.",
  "Honestly I am not sure about this one, I think it is related to transactions but I don't remember exactly.",
  "ACID means atomicity, consistency, isolation and durability. Atomicity means all or nothing, so if one step fails everything is rolled back.",
  "A subquery is a query inside another query, like selecting employees whose salary is greater than the average salary from a subquery.",
];

type Sample = { action: string; ms: number; status: number; code?: string };
const samples: Sample[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function call(token: string, body: Record<string, unknown>, action: string) {
  const t0 = performance.now();
  let status = 0;
  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(`${URL}/functions/v1/b2b-interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  } catch (e) {
    data = { code: (e as Error).name === "TimeoutError" ? "CLIENT_TIMEOUT" : "NETWORK" };
  }
  samples.push({ action, ms: performance.now() - t0, status, code: status >= 400 || status === 0 ? String(data.code ?? status) : undefined });
  return { status, data };
}

async function setup() {
  console.log(`Setting up run ${RUN}: ${STUDENTS} students…`);
  const { data: org, error } = await admin.from("organizations")
    .insert({ name: `Load test ${RUN}`, slug: `load-${RUN}`, type: "college", plan_id: "pro" }).select("id").single();
  if (error) throw error;
  const { data: tmpl, error: tErr } = await admin.from("interview_modules").select("spec").is("org_id", null).eq("name", "SQL").single();
  if (tErr) throw tErr;
  const { data: mod, error: mErr } = await admin.from("interview_modules")
    .insert({ org_id: org.id, spec: { ...tmpl.spec, name: `SQL load ${RUN}`, max_turns: Math.max(ANSWERS + 1, 3) } })
    .select("id").single();
  if (mErr) throw mErr;

  const users: { id: string; email: string; password: string }[] = [];
  for (let i = 0; i < STUDENTS; i++) {
    const email = `load-${RUN}-${i}@example.com`;
    const password = `Load-${RUN}-${i}-Aa1`;
    const { data, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (uErr) throw uErr;
    users.push({ id: data.user.id, email, password });
  }
  const { error: memErr } = await admin.from("org_memberships")
    .insert(users.map((u, i) => ({ org_id: org.id, user_id: u.id, role: "student", full_name: `Student ${i}`, email: u.email, roll_no: `LT${i}` })));
  if (memErr) throw memErr;
  return { orgId: org.id as string, moduleId: mod.id as string, users };
}

async function student(i: number, u: { email: string; password: string }, moduleId: string) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: auth, error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error || !auth.session) { samples.push({ action: "signin", ms: 0, status: 401, code: "SIGNIN" }); return; }
  const token = auth.session.access_token;

  const started = await call(token, { action: "start", moduleId, clientMeta: { browser: "load-test", input_mode: "text" } }, "start");
  if (started.status !== 200) return;
  let p = started.data as { interview: { id: string; turn_count: number; status: string } };
  for (let k = 0; k < ANSWERS && p.interview?.status === "in_progress"; k++) {
    await sleep(rand(THINK_MIN, THINK_MAX) * 1000); // student thinking + speaking
    const clientTurnId = crypto.randomUUID();
    const body = {
      action: "answer", interviewId: p.interview.id, clientTurnId, turnCount: p.interview.turn_count,
      answer: ANSWERS_POOL[(i + k) % ANSWERS_POOL.length],
      meta: { input_mode: "voice", response_latency_ms: Math.round(rand(800, 6000)), speech_ms: Math.round(rand(8000, 40000)) },
    };
    let r = await call(token, body, "answer");
    if (r.status === 0 || r.status >= 500) r = await call(token, body, "answer_retry"); // same clientTurnId, like the UI
    if (r.status !== 200) return;
    p = r.data as typeof p;
  }
}

function pct(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function report(wallMs: number) {
  console.log(`\n=== ${STUDENTS} students, ${ANSWERS} answers each, ramp ${RAMP_S}s, wall ${(wallMs / 1000).toFixed(0)}s ===`);
  const actions = [...new Set(samples.map((s) => s.action))];
  console.log("action        n     ok    err   p50ms  p90ms  p99ms  maxms");
  for (const a of actions) {
    const xs = samples.filter((s) => s.action === a);
    const ok = xs.filter((s) => !s.code);
    const ms = ok.map((s) => s.ms);
    console.log(
      `${a.padEnd(12)} ${String(xs.length).padStart(3)}  ${String(ok.length).padStart(5)}  ${String(xs.length - ok.length).padStart(5)}` +
      `  ${pct(ms, 50).toFixed(0).padStart(6)} ${pct(ms, 90).toFixed(0).padStart(6)} ${pct(ms, 99).toFixed(0).padStart(6)} ${Math.max(0, ...ms).toFixed(0).padStart(6)}`,
    );
  }
  const errs = samples.filter((s) => s.code).reduce<Record<string, number>>((m, s) => ((m[s.code!] = (m[s.code!] ?? 0) + 1), m), {});
  if (Object.keys(errs).length) console.log("errors:", errs);
}

async function llmStats(orgId: string) {
  const { data } = await admin.from("b2b_interview_turns").select("meta").eq("org_id", orgId).eq("role", "interviewer");
  const calls = (data ?? []).flatMap((t: { meta: { llm?: Array<{ latency_ms: number; input_tokens: number; output_tokens: number; attempts: number }>; fallback?: boolean } }) => t.meta?.llm ?? []);
  const fallbacks = (data ?? []).filter((t: { meta: { fallback?: boolean } }) => t.meta?.fallback).length;
  if (!calls.length) return;
  const lat = calls.map((c) => c.latency_ms);
  const retried = calls.filter((c) => c.attempts > 1).length;
  console.log(`LLM calls: ${calls.length}  p50 ${pct(lat, 50)}ms  p90 ${pct(lat, 90)}ms  max ${Math.max(...lat)}ms  retried ${retried}  fallback questions ${fallbacks}`);
  const avgIn = calls.reduce((a, c) => a + c.input_tokens, 0) / calls.length;
  const avgOut = calls.reduce((a, c) => a + c.output_tokens, 0) / calls.length;
  console.log(`tokens/call: in ${avgIn.toFixed(0)}  out ${avgOut.toFixed(0)} (output includes thinking tokens)`);
}

async function cleanup(orgId: string, users: { id: string }[]) {
  if (KEEP) { console.log(`--keep: left org ${orgId} and ${users.length} users in place.`); return; }
  await admin.from("b2b_interviews").delete().eq("org_id", orgId);
  await admin.from("interview_modules").delete().eq("org_id", orgId);
  await admin.from("organizations").delete().eq("id", orgId);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("Cleaned up test org and users.");
}

const { orgId, moduleId, users } = await setup();
const t0 = performance.now();
try {
  await Promise.all(users.map(async (u, i) => {
    await sleep(RAMP_S > 0 ? (i / STUDENTS) * RAMP_S * 1000 : 0);
    await student(i, u, moduleId);
  }));
  report(performance.now() - t0);
  await llmStats(orgId);
} finally {
  await cleanup(orgId, users);
}
