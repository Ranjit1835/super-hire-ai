#!/usr/bin/env node
// One-time setup for testing B2B V1 on local Supabase (after `npx supabase start`).
//   node scripts/b2b-local-setup.mjs [--admin you@example.com] [--password Demo@12345]
// - writes .env.local (browser) and supabase/functions/.env (edge functions); existing values are kept
// - creates the demo accounts below with one password (local only; email confirmation is off locally)
// - makes --admin a super admin
// - seeds a small global question bank: 10 verified MCQs + 2 coding questions as drafts (verify them in the
//   bank once JUDGE0_URL is set)
// Never run against production: it refuses any URL that isn't localhost.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ADMIN = arg("admin", "admin@demo.test").toLowerCase();
const PASSWORD = arg("password", "Demo@12345");

// ── local Supabase keys ────────────────────────────────────────────────────────
const status = {};
try {
  const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m) status[m[1]] = m[2];
  }
} catch {
  console.error("Local Supabase isn't running. Start it first: npx supabase start");
  process.exit(1);
}
const API = status.API_URL;
const ANON = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const SERVICE = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
if (!API || !ANON || !SERVICE) { console.error("Couldn't read API_URL / keys from `supabase status`."); process.exit(1); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(API)) { console.error(`Refusing: ${API} is not local.`); process.exit(1); }

// ── env files (merge: never overwrite a value that's already set) ────────────
function mergeEnv(path, values, header) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [header];
  const have = new Map(lines.map((l, i) => [l.match(/^([A-Z0-9_]+)=/)?.[1], i]).filter(([k]) => k));
  const added = [];
  for (const [k, v] of Object.entries(values)) {
    if (have.has(k)) {
      const i = have.get(k);
      if (lines[i].slice(k.length + 1).trim() === "" && v !== "") lines[i] = `${k}=${v}`;
      continue;
    }
    lines.push(`${k}=${v}`);
    added.push(k);
  }
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"));
  console.log(`${path}: ${added.length ? `added ${added.join(", ")}` : "already set"}`);
}
mergeEnv(".env.local", {
  VITE_SUPABASE_URL: API,
  VITE_SUPABASE_PUBLISHABLE_KEY: ANON,
  VITE_B2B_ENABLED: "true",
  VITE_B2B_LIVE_SPIKE: "true",
}, "# Local B2B testing (overrides .env; never committed)");
mergeEnv("supabase/functions/.env", {
  B2B_ENABLED: "true",
  APP_BASE_URL: "http://localhost:8080",
  B2B_HASH_SALT: randomBytes(24).toString("hex"),
  B2B_CRON_SECRET: randomBytes(24).toString("hex"),
  GEMINI_API_KEY: "",
  JUDGE0_URL: "",
  JUDGE0_AUTH_TOKEN: "",
}, "# Local edge-function secrets for `npx supabase functions serve` (never committed)");

// ── REST helpers (service role; local only) ────────────────────────────────────
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function call(method, path, body, extra = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

// ── demo accounts ────────────────────────────────────────────────────────────
const ACCOUNTS = [
  [ADMIN, "Super admin"],
  ["tpo@demo.test", "TPO admin (college)"], ["trainer@demo.test", "Trainer (college)"],
  ["s1@demo.test", "Asha Reddy"], ["s2@demo.test", "Bala Kumar"], ["s3@demo.test", "Chitra N"],
  ["s4@demo.test", "Dinesh P"], ["s5@demo.test", "Esha M"], ["s6@demo.test", "Farhan S"],
  ["companyadmin@demo.test", "Company admin"], ["recruiter@demo.test", "Recruiter"], ["hm@demo.test", "Hiring manager"],
];
const existing = new Map();
for (let page = 1; page < 20; page++) {
  const r = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`);
  const users = r.users ?? [];
  for (const u of users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
  if (users.length < 200) break;
}
const ids = {};
for (const [email, name] of ACCOUNTS) {
  if (existing.has(email)) { ids[email] = existing.get(email); continue; }
  const u = await call("POST", "/auth/v1/admin/users", {
    email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name, full_name: name },
  });
  ids[email] = u.id;
}
console.log(`Accounts ready (${ACCOUNTS.length}), password: ${PASSWORD}`);

await call("POST", "/rest/v1/user_roles?on_conflict=user_id,role", { user_id: ids[ADMIN], role: "admin" },
  { Prefer: "resolution=ignore-duplicates" });
console.log(`Super admin: ${ADMIN}`);

// ── global question bank ───────────────────────────────────────────────────────
const already = await call("GET", "/rest/v1/questions?select=id&org_id=is.null&source=eq.import&limit=1");
if (already.length) {
  console.log("Question bank: demo questions already seeded");
} else {
  const opt = (...texts) => texts.map((text, i) => ({ id: "abcdef"[i], text }));
  const mcq = (title, statement, category, topics, options, answer, difficulty = "easy") => ({
    org_id: null, type: "mcq", title, statement, difficulty, topics, category, options, answer,
    multi_select: answer.length > 1, status: "verified", source: "import", points: 1,
  });
  const mcqs = [
    mcq("Train crossing a pole", "A train 150 m long crosses a pole in 10 seconds. What is its speed in km/h?", "aptitude", ["speed"],
      opt("45", "54", "60", "72"), ["b"]),
    mcq("Simple interest", "What is the simple interest on ₹8,000 at 5% per year for 3 years?", "aptitude", ["interest"],
      opt("₹1,000", "₹1,200", "₹1,400", "₹1,600"), ["b"]),
    mcq("Work together", "A finishes a job in 12 days and B in 18 days. Working together, how many days do they take?", "aptitude", ["time-and-work"],
      opt("6", "7.2", "8", "9"), ["b"], "medium"),
    mcq("Number series", "Find the next number: 2, 6, 12, 20, 30, ?", "aptitude", ["series"],
      opt("40", "42", "44", "48"), ["b"]),
    mcq("Percentage change", "A price rises by 20% and then falls by 20%. What is the net change?", "aptitude", ["percentage"],
      opt("No change", "4% decrease", "4% increase", "2% decrease"), ["b"], "medium"),
    mcq("Binary search complexity", "What is the worst-case time complexity of binary search on a sorted array of n elements?", "cs_fundamentals", ["algorithms"],
      opt("O(1)", "O(log n)", "O(n)", "O(n log n)"), ["b"]),
    mcq("Stack behaviour", "Which data structure follows Last In, First Out (LIFO)?", "cs_fundamentals", ["data-structures"],
      opt("Queue", "Stack", "Heap", "Linked list"), ["b"]),
    mcq("SQL join", "Which join returns only the rows that have matching values in both tables?", "cs_fundamentals", ["dbms"],
      opt("LEFT JOIN", "INNER JOIN", "FULL OUTER JOIN", "CROSS JOIN"), ["b"]),
    mcq("Process vs thread", "Which statements about threads of the same process are true? (Choose all that apply)", "cs_fundamentals", ["os"],
      opt("They share the heap", "They share the same stack", "They share open files", "Each has its own program counter"), ["a", "c", "d"], "medium"),
    mcq("HTTP status", "Which HTTP status code means the client must authenticate to get the response?", "cs_fundamentals", ["networks"],
      opt("200", "301", "401", "500"), ["c"]),
  ];
  await call("POST", "/rest/v1/questions", mcqs, { Prefer: "return=minimal" });

  const coding = [
    {
      q: { title: "Pair with target sum", difficulty: "easy", topics: ["arrays", "hashing"],
        statement: "Given n integers and a target k, print YES if two different positions hold values that add up to k, otherwise NO.\n\nInput: first line n and k; second line n integers.\nOutput: YES or NO.",
        constraints: "1 ≤ n ≤ 10^5; |values|, |k| ≤ 10^9",
        starter_code: { python: "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # your code here\n\nmain()\n" } },
      tests: [["4 9\n2 7 11 15\n", "YES\n", true], ["3 10\n1 2 3\n", "NO\n", true], ["5 0\n-3 1 3 4 5\n", "YES\n", false],
              ["2 8\n4 5\n", "NO\n", false], ["1 2\n1\n", "NO\n", false]],
      ref: "import sys\ndata = sys.stdin.read().split()\nn, k = int(data[0]), int(data[1])\nseen = set()\nans = 'NO'\nfor x in map(int, data[2:2 + n]):\n    if k - x in seen:\n        ans = 'YES'\n        break\n    seen.add(x)\nprint(ans)\n",
    },
    {
      q: { title: "Longest run of equal characters", difficulty: "easy", topics: ["strings"],
        statement: "Given a string s of lowercase letters, print the length of the longest block of the same character in a row.\n\nInput: one line with s.\nOutput: one integer.",
        constraints: "1 ≤ |s| ≤ 10^5",
        starter_code: { python: "s = input().strip()\n# your code here\n" } },
      tests: [["aaabbc\n", "3\n", true], ["abc\n", "1\n", true], ["zzzzz\n", "5\n", false], ["abbbbcccd\n", "4\n", false]],
      ref: "s = input().strip()\nbest = cur = 1\nfor i in range(1, len(s)):\n    cur = cur + 1 if s[i] == s[i - 1] else 1\n    best = max(best, cur)\nprint(best)\n",
    },
  ];
  for (const c of coding) {
    const [row] = await call("POST", "/rest/v1/questions", {
      org_id: null, type: "coding", category: "coding", languages: ["python", "java", "cpp", "c", "javascript"],
      time_limit_ms: 2000, memory_limit_kb: 256000, status: "draft", source: "import", points: 10, ...c.q,
    }, { Prefer: "return=representation" });
    await call("POST", "/rest/v1/test_cases", c.tests.map(([input, expected_output, is_sample], ordinal) => ({
      question_id: row.id, ordinal, input, expected_output, is_sample,
    })), { Prefer: "return=minimal" });
    await call("POST", "/rest/v1/reference_solutions", { question_id: row.id, language: "python", code: c.ref },
      { Prefer: "return=minimal" });
  }
  console.log("Question bank: 10 verified MCQs + 2 coding drafts (verify them in /assess/bank/global once Judge0 is set)");
}

console.log(`
Next:
  1. Put your Gemini key in supabase/functions/.env (GEMINI_API_KEY=...) and, if you have one, JUDGE0_URL.
  2. npx supabase functions serve --env-file supabase/functions/.env
  3. npm run dev   → http://localhost:8080  (sign in as ${ADMIN} / ${PASSWORD})
  Then follow docs/b2b/TESTING.md.`);
