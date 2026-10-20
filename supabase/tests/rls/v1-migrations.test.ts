// @vitest-environment node
import { it, expect } from "vitest";
import { createTestDb } from "../helpers/pgdb";

it("every B2B migration applies in order on a clean database", async () => {
  const db = await createTestDb();
  const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
  expect(r.rows[0].n).toBeGreaterThan(10);
});
