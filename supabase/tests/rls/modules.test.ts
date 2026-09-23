// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected } from "../helpers/pgdb";
import { normalizeModuleSpec, type ModuleSpec } from "../../functions/_shared/module-spec";

let db: PGlite;
const u: Record<string, string> = {};
const org = { pilot: "", basic: "", other: "" };

const spec = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({
  name: "Spring Boot Basics", type: "skill", topics: ["REST controllers", "Dependency injection"],
  pass_threshold: 6, max_turns: 8, max_minutes: 12, ...over,
});

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminP", "trainerP", "studentP", "adminB", "studentB", "adminO", "b2c"]) u[k] = await createUser(db);
  const mk = async (slug: string, plan: string) =>
    (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, plan_id) VALUES ($1, $1, 'college', $2) RETURNING id", [slug, plan])).id;
  org.pilot = await mk("pilot-college", "pilot");
  org.basic = await mk("basic-college", "basic");
  org.other = await mk("other-college", "pilot");
  const add = (o: string, id: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [o, id, role]);
  await add(org.pilot, u.adminP, "org_admin");
  await add(org.pilot, u.trainerP, "trainer");
  await add(org.pilot, u.studentP, "student");
  await add(org.basic, u.adminB, "org_admin");
  await add(org.basic, u.studentB, "student");
  await add(org.other, u.adminO, "org_admin");
});

describe("seeded library", () => {
  it("has the 6 skill/HR templates and 5 company-style packs, all valid and labelled as practice", async () => {
    const rows = (await db.query<{ name: string; type: string; spec: ModuleSpec }>(
      "SELECT name, type, spec FROM interview_modules WHERE org_id IS NULL ORDER BY type, name")).rows;
    expect(rows.filter((r) => r.type !== "company_pack").map((r) => r.name).sort()).toEqual(
      ["Advanced Java", "DSA Basics", "HR / Behavioral", "Java Fundamentals", "Python Fundamentals", "SQL"]);
    const packs = rows.filter((r) => r.type === "company_pack");
    expect(packs.map((r) => r.name.split("-")[0]).sort()).toEqual(["Accenture", "Cognizant", "Infosys", "TCS", "Wipro"]);
    for (const p of packs) {
      expect(p.name).toMatch(/\(practice\)$/);
      expect(p.spec.description).toMatch(/Unofficial practice.*Not affiliated/);
      expect(p.spec.style_notes).toMatch(/Do not claim to represent/);
    }
    // The TS validator accepts every seeded spec unchanged.
    for (const r of rows) {
      const { spec: s, errors } = normalizeModuleSpec(r.spec);
      expect(errors).toEqual({});
      expect(s).toEqual(r.spec);
    }
  });
});

describe("spec validation in the database", () => {
  it.each([
    ["no topics", { topics: [] }],
    ["duplicate topics", { topics: ["Joins", "joins"] }],
    ["bad type", { type: "exam" }],
    ["threshold > 10", { pass_threshold: 11 }],
    ["fractional turns", { max_turns: 7.5 }],
    ["too many minutes", { max_minutes: 90 }],
    ["huge style notes", { style_notes: "x".repeat(2001) }],
    ["non-string topic", { topics: [42] }],
  ])("rejects %s", async (_label, over) => {
    await expect(db.query("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.pilot, JSON.stringify(spec(over as Partial<ModuleSpec>))]))
      .rejects.toThrow(/check constraint|violates/);
  });

  it("bumps version only when the spec changes, and org_id is immutable", async () => {
    const m = await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org.pilot, JSON.stringify(spec({ name: "Versioned" }))]);
    await db.query("UPDATE interview_modules SET is_active = true WHERE id = $1", [m.id]);
    expect((await one<{ version: number }>("SELECT version FROM interview_modules WHERE id = $1", [m.id])).version).toBe(1);
    await db.query("UPDATE interview_modules SET spec = jsonb_set(spec, '{max_turns}', '10') WHERE id = $1", [m.id]);
    expect((await one<{ version: number }>("SELECT version FROM interview_modules WHERE id = $1", [m.id])).version).toBe(2);
    await expect(db.query("UPDATE interview_modules SET org_id = $1 WHERE id = $2", [org.other, m.id])).rejects.toThrow(/immutable/);
  });
});

describe("company packs vs plan", () => {
  it("a Basic-plan org cannot enable a company pack; a Pilot org can", async () => {
    const pack = await one<{ spec: ModuleSpec; id: string }>("SELECT id, spec FROM interview_modules WHERE org_id IS NULL AND type = 'company_pack' LIMIT 1");
    await asUser(db, u.adminB, async (tx) => {
      expect(await expectRejected(tx, "INSERT INTO interview_modules (org_id, spec, template_id) VALUES ($1, $2, $3)",
        [org.basic, JSON.stringify(pack.spec), pack.id])).toMatch(/PLAN_FEATURE/);
      // Nor by changing a skill module's type.
      const r = await tx.query<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org.basic, JSON.stringify(spec({ name: "Sneaky" }))]);
      expect(await expectRejected(tx, "UPDATE interview_modules SET spec = jsonb_set(spec, '{type}', '\"company_pack\"') WHERE id = $1", [r.rows[0].id]))
        .toMatch(/PLAN_FEATURE/);
    });
    await asUser(db, u.adminP, async (tx) => {
      await tx.query("INSERT INTO interview_modules (org_id, spec, template_id) VALUES ($1, $2, $3)", [org.pilot, JSON.stringify(pack.spec), pack.id]);
    });
  });

  it("students on a plan without packs never see pack modules even if one exists (e.g. after a downgrade)", async () => {
    const pack = await one<{ spec: ModuleSpec }>("SELECT spec FROM interview_modules WHERE org_id IS NULL AND type = 'company_pack' LIMIT 1");
    await db.query("UPDATE organizations SET plan_id = 'pilot' WHERE id = $1", [org.basic]);
    await db.query("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.basic, JSON.stringify({ ...pack.spec, name: "Pack before downgrade" })]);
    await db.query("UPDATE organizations SET plan_id = 'basic' WHERE id = $1", [org.basic]);
    await db.query("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.basic, JSON.stringify(spec({ name: "Basic SQL" }))]);
    await asUser(db, u.studentB, async (tx) => {
      const names = (await tx.query<{ name: string }>("SELECT name FROM interview_modules WHERE org_id = $1", [org.basic])).rows.map((r) => r.name);
      expect(names).not.toContain("Pack before downgrade");
      expect(names).toContain("Basic SQL");
    });
  });
});

describe("visibility and writes", () => {
  let pilotModule = "";
  let archived = "";
  beforeAll(async () => {
    pilotModule = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org.pilot, JSON.stringify(spec({ name: "Pilot SQL" }))])).id;
    archived = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec, is_active) VALUES ($1, $2, false) RETURNING id", [org.pilot, JSON.stringify(spec({ name: "Old module" }))])).id;
  });

  it("students see active modules of their own org only; staff also see archived", async () => {
    await asUser(db, u.studentP, async (tx) => {
      const ids = (await tx.query<{ id: string }>("SELECT id FROM interview_modules WHERE org_id IS NOT NULL")).rows.map((r) => r.id);
      expect(ids).toContain(pilotModule);
      expect(ids).not.toContain(archived);
      expect((await tx.query("SELECT * FROM interview_modules WHERE org_id = $1", [org.other])).rows).toEqual([]);
      expect((await tx.query("UPDATE interview_modules SET is_active = false WHERE id = $1", [pilotModule])).affectedRows ?? 0).toBe(0);
    });
    await asUser(db, u.trainerP, async (tx) => {
      const ids = (await tx.query<{ id: string }>("SELECT id FROM interview_modules WHERE org_id = $1", [org.pilot])).rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([pilotModule, archived]));
      expect((await tx.query("UPDATE interview_modules SET is_active = false WHERE id = $1", [pilotModule])).affectedRows ?? 0).toBe(0);
    });
  });

  it("library templates are visible to institution members but not to B2C users, and only super-admin edits them", async () => {
    await asUser(db, u.b2c, async (tx) => expect((await tx.query("SELECT * FROM interview_modules")).rows).toEqual([]));
    await asUser(db, u.studentP, async (tx) => {
      expect((await tx.query("SELECT * FROM interview_modules WHERE org_id IS NULL")).rows.length).toBe(11);
    });
    await asUser(db, u.adminP, async (tx) => {
      expect((await tx.query("UPDATE interview_modules SET is_active = false WHERE org_id IS NULL")).affectedRows ?? 0).toBe(0);
      await expectRejected(tx, "INSERT INTO interview_modules (org_id, spec) VALUES (NULL, $1)", [JSON.stringify(spec({ name: "Fake template" }))]);
    });
    await asUser(db, u.super, async (tx) => {
      expect((await tx.query("UPDATE interview_modules SET is_active = true WHERE org_id IS NULL")).affectedRows).toBe(11);
    });
  });

  it("org admins cannot touch another org's modules", async () => {
    await asUser(db, u.adminO, async (tx) => {
      expect((await tx.query("SELECT * FROM interview_modules WHERE id = $1", [pilotModule])).rows).toEqual([]);
      expect((await tx.query("UPDATE interview_modules SET spec = $1 WHERE id = $2", [JSON.stringify(spec({ name: "pwned" })), pilotModule])).affectedRows ?? 0).toBe(0);
      expect((await tx.query("DELETE FROM interview_modules WHERE id = $1", [pilotModule])).affectedRows ?? 0).toBe(0);
      await expectRejected(tx, "INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.pilot, JSON.stringify(spec({ name: "Injected" }))]);
    });
  });

  it("module names are unique among an org's active modules", async () => {
    await expect(db.query("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.pilot, JSON.stringify(spec({ name: "pilot sql" }))]))
      .rejects.toThrow(/duplicate/);
    // Archived names can be reused.
    await db.query("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2)", [org.pilot, JSON.stringify(spec({ name: "Old module" }))]);
  });
});
