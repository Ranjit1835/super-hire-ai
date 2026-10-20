// ─── Judge0 CE 1.13 client ───────────────────────────────────────────────────
// Candidate code never runs in the web app or the edge runtime: it goes to a Judge0 server
// (env JUDGE0_URL, optional JUDGE0_AUTH_TOKEN sent as X-Auth-Token). This file has no Deno or
// network globals of its own (fetch/sleep/now are injected), so it is unit-tested in Node
// (supabase/tests/unit/judge0.test.ts).
//
// Flow: POST /submissions/batch?base64_encoded=true&wait=false → tokens; poll
// GET /submissions/batch?tokens=…&base64_encoded=true until every run is finished or the hard
// timeout passes. We don't send expected_output: outputs are compared here (trailing whitespace per
// line is ignored), so Judge0's "Accepted" (3) just means "ran without error".

export type Language = "python" | "java" | "cpp" | "c" | "javascript";

export const LANGUAGE_IDS: Record<Language, number> = {
  python: 71,      // Python 3.8.1
  java: 62,        // Java (OpenJDK 13.0.1)
  cpp: 54,         // C++ (GCC 9.2.0)
  c: 50,           // C (GCC 9.2.0)
  javascript: 63,  // JavaScript (Node.js 12.14.0)
};

/** Our per-test verdicts. */
export type RunStatus =
  | "passed" | "wrong_answer" | "time_limit" | "compile_error" | "runtime_error" | "internal_error" | "timeout" | "ran";

export interface Limits { timeLimitMs?: number | null; memoryLimitKb?: number | null }

export interface RunRequest { language: Language; code: string; stdin: string }

export interface RunOutcome {
  status: RunStatus;           // "ran" = finished OK (outputs not compared yet)
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeMs: number | null;
  memoryKb: number | null;
  judgeStatusId: number | null;
}

export interface Judge0Config {
  url: string;
  authToken?: string | null;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Hard limit for one batch (submit + polling). */
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Per HTTP request. */
  requestTimeoutMs?: number;
}

export class Judge0Error extends Error {
  constructor(public code: "JUDGE0_UNAVAILABLE" | "JUDGE0_BAD_RESPONSE", message: string) { super(message); }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
export function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64decode(s: string | null | undefined): string {
  if (!s) return "";
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Normalise program output: CRLF → LF, trailing whitespace per line dropped, trailing blank lines dropped. */
export function normalizeOutput(s: string): string {
  return s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

/** Judge0 limits from the question's (seconds, KB), clamped to what a default Judge0 install accepts. */
export function judgeLimits(l: Limits) {
  const cpu = Math.min(Math.max((l.timeLimitMs ?? 2000) / 1000, 0.1), 15);
  const memory = Math.min(Math.max(l.memoryLimitKb ?? 256000, 16000), 512000);
  return { cpu_time_limit: cpu, wall_time_limit: Math.min(cpu * 3 + 1, 20), memory_limit: memory };
}

export function buildSubmission(run: RunRequest, limits: Limits) {
  return {
    language_id: LANGUAGE_IDS[run.language],
    source_code: b64encode(run.code),
    stdin: b64encode(run.stdin),
    ...judgeLimits(limits),
  };
}

/** Judge0 status id → our status. 1/2 (queued/processing) → null (not finished). */
export function mapStatus(id: number): RunStatus | null {
  if (id === 1 || id === 2) return null;
  if (id === 3) return "ran";
  if (id === 4) return "wrong_answer";
  if (id === 5) return "time_limit";
  if (id === 6) return "compile_error";
  if (id >= 7 && id <= 12) return "runtime_error";
  return "internal_error";   // 13 internal error, 14 exec format error, anything unknown
}

interface RawSubmission {
  token?: string;
  stdout?: string | null; stderr?: string | null; compile_output?: string | null; message?: string | null;
  status?: { id: number; description?: string } | null;
  time?: string | number | null; memory?: number | null;
}

export function toOutcome(raw: RawSubmission): RunOutcome | null {
  const id = raw.status?.id ?? 0;
  const status = mapStatus(id);
  if (status === null) return null;
  const t = raw.time === null || raw.time === undefined ? null : Math.round(Number(raw.time) * 1000);
  return {
    status,
    stdout: b64decode(raw.stdout),
    stderr: b64decode(raw.stderr) || b64decode(raw.message),
    compileOutput: b64decode(raw.compile_output),
    timeMs: Number.isFinite(t) ? t : null,
    memoryKb: raw.memory ?? null,
    judgeStatusId: id,
  };
}

// ── Client ───────────────────────────────────────────────────────────────────
const BATCH = 20;   // Judge0's default max batch size
const FIELDS = "token,stdout,stderr,compile_output,message,status,time,memory";

export interface Judge0Client { run(runs: RunRequest[], limits: Limits): Promise<RunOutcome[]> }

export function createJudge0(cfg: Judge0Config): Judge0Client {
  const base = cfg.url.replace(/\/+$/, "");
  const sleep = cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = cfg.now ?? Date.now;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authToken) headers["X-Auth-Token"] = cfg.authToken;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await cfg.fetch(`${base}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch (e) {
      throw new Judge0Error("JUDGE0_UNAVAILABLE", `Judge0 request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Judge0Error("JUDGE0_UNAVAILABLE", `Judge0 answered HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new Judge0Error("JUDGE0_BAD_RESPONSE", "Judge0 sent invalid JSON"); }
  }

  async function runChunk(runs: RunRequest[], limits: Limits, deadline: number): Promise<RunOutcome[]> {
    const created = await request("/submissions/batch?base64_encoded=true&wait=false", {
      method: "POST", body: JSON.stringify({ submissions: runs.map((r) => buildSubmission(r, limits)) }),
    });
    if (!Array.isArray(created) || created.some((c) => !c || typeof (c as RawSubmission).token !== "string")) {
      throw new Judge0Error("JUDGE0_BAD_RESPONSE", "Judge0 didn't return submission tokens");
    }
    const tokens = (created as RawSubmission[]).map((c) => c.token!);
    const done: (RunOutcome | null)[] = tokens.map(() => null);
    let interval = cfg.pollIntervalMs ?? 500;
    while (done.some((d) => d === null)) {
      if (now() >= deadline) break;
      await sleep(interval);
      interval = Math.min(interval * 1.5, 2_000);
      const pending = tokens.filter((_, i) => done[i] === null);
      const got = await request(`/submissions/batch?tokens=${pending.join(",")}&base64_encoded=true&fields=${FIELDS}`, { method: "GET" });
      const subs = (got as { submissions?: RawSubmission[] })?.submissions;
      if (!Array.isArray(subs)) throw new Judge0Error("JUDGE0_BAD_RESPONSE", "Judge0 poll returned no submissions");
      for (const s of subs) {
        const i = tokens.indexOf(s?.token ?? "");
        if (i >= 0 && done[i] === null) done[i] = toOutcome(s);
      }
    }
    return done.map((d) => d ?? {
      status: "timeout" as const, stdout: "", stderr: "", compileOutput: "", timeMs: null, memoryKb: null, judgeStatusId: null,
    });
  }

  return {
    async run(runs, limits) {
      const deadline = now() + (cfg.timeoutMs ?? 60_000);
      const out: RunOutcome[] = [];
      for (let i = 0; i < runs.length; i += BATCH) out.push(...await runChunk(runs.slice(i, i + BATCH), limits, deadline));
      return out;
    },
  };
}

// ── Judging a question's tests ───────────────────────────────────────────────
export interface TestCase { id: string; input: string; expected_output: string; is_sample: boolean; weight: number | string }

export interface TestVerdict {
  test_id: string;
  sample: boolean;
  passed: boolean;
  status: RunStatus;
  time_ms: number | null;
  memory_kb: number | null;
  stdout?: string;      // samples only
  expected?: string;    // samples only
}

export interface JudgeSummary {
  tests: TestVerdict[];
  compile_output: string | null;
  passed: number;
  total: number;
  /** Weighted fraction of tests passed, 0..1. */
  fraction: number;
}

/** Final verdict for one test: a clean run passes only if the output matches. */
export function verdict(test: TestCase, o: RunOutcome): TestVerdict {
  const status: RunStatus = o.status === "ran" ? (outputsMatch(o.stdout, test.expected_output) ? "passed" : "wrong_answer") : o.status;
  const v: TestVerdict = {
    test_id: test.id, sample: test.is_sample, passed: status === "passed", status, time_ms: o.timeMs, memory_kb: o.memoryKb,
  };
  if (test.is_sample) { v.stdout = o.stdout.slice(0, 10_000); v.expected = test.expected_output.slice(0, 10_000); }
  return v;
}

export function summarize(tests: TestCase[], outcomes: RunOutcome[]): JudgeSummary {
  const verdicts = tests.map((t, i) => verdict(t, outcomes[i]));
  const totalWeight = tests.reduce((s, t) => s + Number(t.weight), 0);
  const passedWeight = tests.reduce((s, t, i) => s + (verdicts[i].passed ? Number(t.weight) : 0), 0);
  const compile = outcomes.find((o) => o.status === "compile_error")?.compileOutput ?? null;
  return {
    tests: verdicts,
    compile_output: compile ? compile.slice(0, 20_000) : null,
    passed: verdicts.filter((v) => v.passed).length,
    total: tests.length,
    fraction: totalWeight > 0 ? passedWeight / totalWeight : 0,
  };
}

/** Weighted test-case score for a coding question worth `points`, rounded to 2 decimals. */
export function codingScore(points: number, summary: Pick<JudgeSummary, "fraction">): number {
  return Math.round(points * summary.fraction * 100) / 100;
}

export async function judgeTests(client: Judge0Client, language: Language, code: string, tests: TestCase[], limits: Limits): Promise<JudgeSummary> {
  if (tests.length === 0) return { tests: [], compile_output: null, passed: 0, total: 0, fraction: 0 };
  const outcomes = await client.run(tests.map((t) => ({ language, code, stdin: t.input })), limits);
  return summarize(tests, outcomes);
}

/** Read the Judge0 config from env values; null when JUDGE0_URL isn't set (server not created yet). */
export function judge0FromEnv(get: (k: string) => string | undefined, fetchImpl: typeof fetch): Judge0Client | null {
  const url = (get("JUDGE0_URL") ?? "").trim();
  if (!url) return null;
  return createJudge0({ url, authToken: (get("JUDGE0_AUTH_TOKEN") ?? "").trim() || null, fetch: fetchImpl });
}
