// @vitest-environment node
// The global bank seed (scripts/seed-global-bank.mjs) applies cleanly, twice, without adding anything the second time.
import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/pgdb";
// @ts-expect-error plain .mjs script
import { buildSeedSql } from "../../../scripts/seed-global-bank.mjs";

describe("global bank seed SQL", () => {
  it("passes every table check and is idempotent", async () => {
    const db = await createTestDb();
    const sql = buildSeedSql() as string;
    await db.exec(sql);
    await db.exec(sql);
    const r = await db.query<{ t: string; s: string; n: number }>(
      "SELECT type AS t, status AS s, count(*)::int AS n FROM questions WHERE org_id IS NULL GROUP BY type, status ORDER BY type");
    expect(r.rows).toEqual([{ t: "coding", s: "draft", n: 4 }, { t: "mcq", s: "verified", n: 70 }]);
    const tc = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM test_cases");
    const ref = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM reference_solutions");
    expect([tc.rows[0].n, ref.rows[0].n]).toEqual([22, 4]);
  }, 120_000);
});
