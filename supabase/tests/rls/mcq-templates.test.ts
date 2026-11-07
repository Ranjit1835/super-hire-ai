// @vitest-environment node
// R2.2 template families (migration 0036): variants are saved with source 'template' and a family, and a paper
// never holds two variants of the same family.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "../helpers/pgdb";

let db: PGlite;
let org = "", asmt = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
const FAM = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];

beforeAll(async () => {
  db = await createTestDb();
  org = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('Family College', 'family-college', 'college', 100) RETURNING id");
  // 3 families x 6 variants, plus 2 stand-alone questions: at most 5 distinct "questions" per paper.
  for (const f of FAM) {
    for (let v = 0; v < 6; v++) {
      await db.query(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status, source, family_id, params)
        VALUES ($1, 'mcq', $2, 'A train covers some distance; what is its speed?', 'easy', '{speed}', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]', '["a"]', 'verified', 'template', $3, $4)`,
        [org, `Train ${f.slice(-1)}.${v}`, f, JSON.stringify({ values: { d: v } })]);
    }
  }
  for (let i = 0; i < 2; i++) {
    await db.query(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
      VALUES ($1, 'mcq', $2, 'A stand-alone speed question for this test.', 'easy', '{speed}', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]', '["a"]', 'verified')`,
      [org, `Standalone ${i}`]);
  }
  asmt = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, practice_enabled, status, max_overlap_pct)
    VALUES ($1, 'Speed', 30, $2, true, 'ready', 100) RETURNING id`, [org, JSON.stringify([{ type: "mcq", title: "Speed", pick: [{ topics: ["speed"], count: 8 }] }])]);
});

describe("template families in papers (R2.2)", () => {
  it("a paper takes at most one variant of each family, across many seeds", async () => {
    for (let s = 0; s < 25; s++) {
      const set = (await db.query<{ r: { question_id: string }[] }>(
        "SELECT public._b2b_build_question_set($1, $2) AS r", [asmt, `seed-${s}`])).rows[0].r;
      const fams = (await db.query<{ f: string | null }>("SELECT family_id::text AS f FROM questions WHERE id = ANY ($1::uuid[])",
        [set.map((x) => x.question_id)])).rows.map((r) => r.f).filter(Boolean);
      expect(new Set(fams).size).toBe(fams.length);
      expect(set).toHaveLength(5);                                       // 3 families + 2 stand-alone, not 8
    }
  });

  it("different students get different variants of the same family", async () => {
    const pick = async (seed: string) => (await db.query<{ r: { question_id: string }[] }>(
      "SELECT public._b2b_build_question_set($1, $2) AS r", [asmt, seed])).rows[0].r.map((x) => x.question_id).sort().join();
    const papers = new Set<string>();
    for (let i = 0; i < 10; i++) papers.add(await pick(`student-${i}`));
    expect(papers.size).toBeGreaterThan(5);
  });

  it("'template' is an accepted source; unknown sources are not", async () => {
    await expect(db.query(`INSERT INTO questions (org_id, type, title, statement, difficulty, options, answer, source)
      VALUES ($1, 'mcq', 'Bad source', 'Some statement here.', 'easy', '[{"id":"a","text":"A"}]', '["a"]', 'scraped')`, [org])).rejects.toThrow(/questions_source_check/);
  });
});
