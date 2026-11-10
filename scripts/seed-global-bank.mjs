// Prints the SQL that adds scripts/seed/global-bank.mjs to the global question bank (org_id NULL). Idempotent: a title
// already in the global bank is skipped, so running it twice adds nothing. Run the output in the Supabase SQL editor
// (or psql) as the database owner: node scripts/seed-global-bank.mjs > /tmp/bank.sql
import { pathToFileURL } from "node:url";
import { MCQS, CODING } from "./seed/global-bank.mjs";

const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const arr = (v) => `ARRAY[${v.map(lit).join(", ")}]::text[]`;
const notThere = (title) => `NOT EXISTS (SELECT 1 FROM public.questions WHERE org_id IS NULL AND lower(title) = lower(${lit(title)}))`;

export function buildSeedSql() {
const out = ["BEGIN;"];
for (const q of MCQS) {
  out.push(`INSERT INTO public.questions (org_id, type, title, statement, difficulty, topics, category, options, answer, multi_select, explanation, points, status, source)
SELECT NULL, 'mcq', ${lit(q.title)}, ${lit(q.statement)}, ${lit(q.difficulty)}, ${arr(q.topics)}, ${lit(q.category)}, ${json(q.options)}, ${json(q.answer)}, ${q.answer.length > 1}, ${lit(q.explanation)}, 1, 'verified', 'import'
WHERE ${notThere(q.title)};`);
}
for (const c of CODING) {
  out.push(`WITH q AS (
  INSERT INTO public.questions (org_id, type, title, statement, difficulty, topics, category, languages, starter_code, constraints, time_limit_ms, memory_limit_kb, points, status, source)
  SELECT NULL, 'coding', ${lit(c.title)}, ${lit(c.statement)}, ${lit(c.difficulty)}, ${arr(c.topics)}, 'coding', ARRAY['python','java','cpp','c','javascript']::text[], ${json(c.starter_code)}, ${lit(c.constraints)}, 2000, 256000, 10, 'draft', 'import'
  WHERE ${notThere(c.title)}
  RETURNING id
), t AS (
  INSERT INTO public.test_cases (question_id, ordinal, input, expected_output, is_sample)
  SELECT q.id, x.ordinal, x.input, x.expected_output, x.is_sample FROM q,
    (VALUES ${c.tests.map((t, i) => `(${i}, ${lit(t.input)}, ${lit(t.expected_output)}, ${t.is_sample})`).join(", ")}) AS x(ordinal, input, expected_output, is_sample)
)
INSERT INTO public.reference_solutions (question_id, language, code) SELECT q.id, 'python', ${lit(c.reference)} FROM q;`);
}
out.push("COMMIT;");
return out.join("\n\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) console.log(buildSeedSql());
