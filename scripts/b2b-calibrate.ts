// Calibrate the AI evaluator against human trainer scores.
//
// 1) Make a scoring sheet for trainers (latest completed interviews of an org):
//      node scripts/b2b-calibrate.ts template --org <org-uuid> [--limit 30] > trainer-sheet.csv
//    Trainers read each transcript (institution dashboard) and fill 0–10 per dimension
//    (blank = can't judge) plus readiness_level. Two trainers per interview gives a baseline.
// 2) Compare:
//      node scripts/b2b-calibrate.ts compare --human trainer-sheet.csv [--version evaluator-2026-09-v1] [--out report.json]
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read-only use). Offline: --ai ai-scores.json
// ([{ interview_id, scores: { dimension: number | "insufficient_data" }, readiness }]).
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DIMENSIONS, calibrate, formatReport, parseHumanCsv, type AiRow } from "./calibration-lib.ts";

const [cmd] = process.argv.slice(2);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --ai for offline mode)."); process.exit(1); }
  return createClient(url, key, { auth: { persistSession: false } });
}

type EvalRow = { interview_id: string; evaluator_version: string; result: { dimensions: Record<string, { score: number | string }>; readiness_level: AiRow["readiness"] } };

async function loadAi(ids: string[], version?: string): Promise<AiRow[]> {
  const file = arg("ai");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const client = db();
  const out: AiRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = client.from("b2b_evaluations").select("interview_id, evaluator_version, result, completed_at")
      .in("interview_id", ids.slice(i, i + 200)).eq("status", "completed").order("completed_at", { ascending: false });
    if (version) q = q.eq("evaluator_version", version);
    const { data, error } = await q;
    if (error) throw error;
    const seen = new Set<string>();
    for (const r of (data ?? []) as EvalRow[]) {
      if (seen.has(r.interview_id)) continue; // newest per interview
      seen.add(r.interview_id);
      out.push({
        interview_id: r.interview_id,
        scores: Object.fromEntries(DIMENSIONS.map((d) => {
          const s = r.result?.dimensions?.[d]?.score;
          return [d, typeof s === "number" ? s : "insufficient_data"];
        })) as AiRow["scores"],
        readiness: r.result?.readiness_level,
      });
    }
  }
  return out;
}

if (cmd === "template") {
  const org = arg("org");
  if (!org) { console.error("--org <org-uuid> is required"); process.exit(1); }
  const client = db();
  const { data: ivs, error } = await client.from("b2b_interviews")
    .select("id, user_id, completed_at, module_spec")
    .eq("org_id", org).in("status", ["completed", "abandoned"])
    .order("completed_at", { ascending: false }).limit(Number(arg("limit") ?? 30));
  if (error) throw error;
  const userIds = [...new Set((ivs ?? []).map((r) => r.user_id))];
  const { data: members, error: mErr } = await client.from("org_memberships")
    .select("user_id, roll_no, full_name").eq("org_id", org).in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  if (mErr) throw mErr;
  const who = new Map((members ?? []).map((m) => [m.user_id, m]));
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  console.log(["interview_id", "roll_no", "student", "module", "rater", ...DIMENSIONS, "readiness_level"].join(","));
  for (const r of ivs ?? []) {
    const m = who.get(r.user_id);
    console.log([r.id, q(m?.roll_no), q(m?.full_name), q((r.module_spec as { name: string }).name), "", ...DIMENSIONS.map(() => ""), ""].join(","));
  }
} else if (cmd === "compare") {
  const humanFile = arg("human");
  if (!humanFile) { console.error("--human <trainer-scores.csv> is required"); process.exit(1); }
  const { rows, errors } = parseHumanCsv(readFileSync(humanFile, "utf8"));
  if (errors.length) console.warn(`Warnings in ${humanFile}:\n  ${errors.join("\n  ")}\n`);
  const ids = [...new Set(rows.map((r) => r.interview_id))];
  const ai = await loadAi(ids, arg("version"));
  const report = calibrate(rows, ai);
  console.log(formatReport(report));
  const out = arg("out");
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`\nWrote ${out}`); }
} else {
  console.log("Usage:\n  node scripts/b2b-calibrate.ts template --org <uuid> [--limit 30] > sheet.csv\n  node scripts/b2b-calibrate.ts compare --human sheet.csv [--version v] [--ai ai.json] [--out report.json]");
}
