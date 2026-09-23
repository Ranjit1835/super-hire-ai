// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomBytes } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const org = { a: "", b: "", small: "" };

const newToken = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const CONSENT = ["b2b-v1", "I agree my interview data is used for assessment and shared with my institution."] as const;

type Result = { row: number; status: "invited" | "skipped" | "error"; reason?: string; invite_id?: string };

function rowsFor(list: Array<{ row: number; name: string; email: string; roll: string; batch?: string; dept?: string }>) {
  const tokens: Record<number, string> = {};
  const rows = list.map((r) => {
    tokens[r.row] = newToken();
    return {
      row: r.row, full_name: r.name, email: r.email, roll_no: r.roll,
      department: r.dept ?? "CSE", batch: r.batch ?? "CSE 2026 A", token_hash: hash(tokens[r.row]),
    };
  });
  return { rows, tokens };
}

async function importRows(actor: string, orgId: string, rows: unknown[]): Promise<Result[]> {
  return asService(db, async (tx) =>
    (await tx.query<{ r: Result[] }>("SELECT public.b2b_import_invites($1, $2, $3::jsonb) AS r", [actor, orgId, JSON.stringify(rows)])).rows[0].r);
}

async function accept(token: string, userId: string, consent: readonly [string, string] = CONSENT) {
  return asService(db, async (tx) =>
    (await tx.query<{ r: Record<string, unknown> }>("SELECT public.b2b_accept_invite($1, $2, $3, $4) AS r",
      [hash(token), userId, consent[0], consent[1]])).rows[0].r);
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "trainerA", "adminB", "existingStudent"]) u[k] = await createUser(db);
  const mk = async (slug: string, plan = "pilot") =>
    (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, plan_id) VALUES ($1, $1, 'college', $2) RETURNING id", [slug, plan])).id;
  org.a = await mk("college-a");
  org.b = await mk("college-b");
  await db.query("INSERT INTO plans (id, name, interviews_per_student, max_students) VALUES ('three', 'Three', 2, 3)");
  org.small = await mk("small-college", "three");
  const add = (o: string, id: string, role: string, email?: string, roll?: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role, email, roll_no) VALUES ($1, $2, $3, $4, $5)", [o, id, role, email ?? null, roll ?? null]);
  await add(org.a, u.adminA, "org_admin");
  await add(org.a, u.trainerA, "trainer");
  await add(org.b, u.adminB, "org_admin");
  await add(org.small, u.adminA, "org_admin");
  await add(org.a, u.existingStudent, "student", "old@x.in", "OLD1");
});

describe("b2b_import_invites", () => {
  it("invites valid rows, creates batches, and skips duplicates with reasons", async () => {
    const { rows } = rowsFor([
      { row: 2, name: "Anil Kumar", email: "anil@x.in", roll: "R001" },
      { row: 3, name: "Anil Again", email: "ANIL@x.in", roll: "R099" },           // dup email in file
      { row: 4, name: "Roll Dup", email: "other@x.in", roll: "r001" },            // dup roll in file (case-insensitive)
      { row: 5, name: "Old Member", email: "old@x.in", roll: "NEW5" },            // already a member
      { row: 6, name: "Divya", email: "divya@x.in", roll: "R002", batch: "ECE 2026", dept: "ECE" },
    ]);
    const res = await importRows(u.adminA, org.a, rows);
    expect(res.map((r) => [r.row, r.status, r.reason ?? null])).toEqual([
      [2, "invited", null],
      [3, "skipped", "Duplicate email in this file"],
      [4, "skipped", "Duplicate roll number in this file"],
      [5, "skipped", "Already a member"],
      [6, "invited", null],
    ]);
    const batches = (await db.query("SELECT name, department FROM batches WHERE org_id = $1 ORDER BY name", [org.a])).rows;
    expect(batches).toEqual([{ name: "CSE 2026 A", department: "CSE" }, { name: "ECE 2026", department: "ECE" }]);

    // Re-uploading the same file is safe: everything is skipped.
    const again = await importRows(u.adminA, org.a, rowsFor([
      { row: 2, name: "Anil Kumar", email: "anil@x.in", roll: "R001" },
      { row: 3, name: "Divya", email: "divya@x.in", roll: "R002" },
    ]).rows);
    expect(again.map((r) => r.reason)).toEqual(["Already invited", "Already invited"]);
  });

  it("refuses trainers, admins of other orgs, and non-members", async () => {
    const { rows } = rowsFor([{ row: 2, name: "X Y", email: "x@x.in", roll: "X1" }]);
    for (const actor of [u.trainerA, u.adminB, u.existingStudent]) {
      await expect(importRows(actor, org.a, rows)).rejects.toThrow(/FORBIDDEN/);
    }
    expect(await importRows(u.super, org.a, rows)).toMatchObject([{ status: "invited" }]);
  });

  it("counts pending invites against the plan's student cap", async () => {
    const { rows } = rowsFor([1, 2, 3, 4].map((i) => ({ row: i + 1, name: `S ${i}`, email: `s${i}@small.in`, roll: `S${i}` })));
    const res = await importRows(u.adminA, org.small, rows);
    expect(res.map((r) => r.status)).toEqual(["invited", "invited", "invited", "error"]);
    expect(res[3].reason).toMatch(/Plan limit reached \(3 students/);
  });

  it("cannot be called from the browser", async () => {
    for (const who of [u.adminA, u.super, null]) {
      await asUser(db, who, async (tx) => {
        expect(await expectRejected(tx, "SELECT public.b2b_import_invites($1, $2, '[]'::jsonb)", [u.adminA, org.a])).toMatch(/permission denied/);
        expect(await expectRejected(tx, "SELECT public.b2b_accept_invite('x', $1, 'v', 't')", [u.adminA])).toMatch(/permission denied/);
        expect(await expectRejected(tx, "SELECT public.b2b_invite_preview('x')")).toMatch(/permission denied/);
      });
    }
  });
});

describe("b2b_accept_invite", () => {
  it("attaches the student to org + batch, records consent, and is idempotent", async () => {
    const { rows, tokens } = rowsFor([{ row: 2, name: "Kiran Rao", email: "kiran@x.in", roll: "K1", batch: "CSE 2026 B" }]);
    await importRows(u.adminA, org.a, rows);
    const kiran = await createUser(db);

    const preview = await asService(db, async (tx) =>
      (await tx.query<{ p: Record<string, unknown> }>("SELECT public.b2b_invite_preview($1) AS p", [hash(tokens[2])])).rows[0].p);
    expect(preview).toMatchObject({ status: "pending", full_name: "Kiran Rao", batch: "CSE 2026 B", org: { name: "college-a" } });

    expect(await accept(tokens[2], kiran)).toMatchObject({ ok: true, org_id: org.a });
    const m = await one("SELECT role, full_name, email, roll_no, (SELECT name FROM batches b WHERE b.id = m.batch_id) AS batch FROM org_memberships m WHERE user_id = $1", [kiran]);
    expect(m).toEqual({ role: "student", full_name: "Kiran Rao", email: "kiran@x.in", roll_no: "K1", batch: "CSE 2026 B" });
    expect(await one("SELECT consent_version, consent_text FROM org_consents WHERE user_id = $1", [kiran]))
      .toEqual({ consent_version: CONSENT[0], consent_text: CONSENT[1] });

    expect(await accept(tokens[2], kiran)).toMatchObject({ ok: true, already: true });
    const other = await createUser(db);
    expect(await accept(tokens[2], other)).toMatchObject({ ok: false, reason: "ALREADY_USED" });
  });

  it("requires consent", async () => {
    const { rows, tokens } = rowsFor([{ row: 2, name: "No Consent", email: "nc@x.in", roll: "NC1" }]);
    await importRows(u.adminA, org.a, rows);
    expect(await accept(tokens[2], await createUser(db), ["", ""])).toMatchObject({ ok: false, reason: "CONSENT_REQUIRED" });
  });

  it("rejects unknown, expired and revoked links", async () => {
    expect(await accept(newToken(), await createUser(db))).toMatchObject({ ok: false, reason: "INVALID" });

    const { rows, tokens } = rowsFor([
      { row: 2, name: "Late Student", email: "late@x.in", roll: "L1" },
      { row: 3, name: "Revoked Student", email: "rev@x.in", roll: "RV1" },
    ]);
    const res = await importRows(u.adminA, org.a, rows);
    await db.query("UPDATE org_invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [res[0].invite_id]);
    expect(await accept(tokens[2], await createUser(db))).toMatchObject({ ok: false, reason: "EXPIRED" });

    await expect(asService(db, (tx) => tx.query("SELECT public.b2b_revoke_invite($1, $2)", [u.adminB, res[1].invite_id]))).rejects.toThrow(/FORBIDDEN/);
    await asService(db, (tx) => tx.query("SELECT public.b2b_revoke_invite($1, $2)", [u.adminA, res[1].invite_id]));
    expect(await accept(tokens[3], await createUser(db))).toMatchObject({ ok: false, reason: "REVOKED" });

    // A revoked invite no longer blocks re-inviting the same student.
    const again = await importRows(u.adminA, org.a, rowsFor([{ row: 2, name: "Revoked Student", email: "rev@x.in", roll: "RV1" }]).rows);
    expect(again[0].status).toBe("invited");
  });

  it("does not turn a staff account into a student", async () => {
    const { rows, tokens } = rowsFor([{ row: 2, name: "Trainer Self", email: "t@x.in", roll: "T1" }]);
    await importRows(u.adminA, org.a, rows);
    expect(await accept(tokens[2], u.trainerA)).toMatchObject({ ok: false, reason: "STAFF_ACCOUNT" });
  });

  it("enforces the student cap at acceptance too", async () => {
    // small org: 3 invites already pending from the import test; fill the cap with direct members first.
    const pending = (await db.query<{ id: string }>("SELECT id FROM org_invites WHERE org_id = $1 AND status = 'pending' ORDER BY roll_no", [org.small])).rows;
    for (let i = 0; i < 3; i++) {
      await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org.small, await createUser(db)]);
    }
    const token = newToken();
    await db.query("UPDATE org_invites SET token_hash = $1 WHERE id = $2", [hash(token), pending[0].id]);
    expect(await accept(token, await createUser(db))).toMatchObject({ ok: false, reason: "STUDENT_LIMIT_REACHED" });
    expect((await one<{ status: string }>("SELECT status FROM org_invites WHERE id = $1", [pending[0].id])).status).toBe("pending");
  });
});

describe("b2b_rotate_invite", () => {
  it("issues a new link and kills the old one", async () => {
    const { rows, tokens } = rowsFor([{ row: 2, name: "Rotate Me", email: "rot@x.in", roll: "RO1" }]);
    const [res] = await importRows(u.adminA, org.a, rows);
    const fresh = newToken();
    expect(await asService(db, async (tx) =>
      (await tx.query<{ r: unknown }>("SELECT public.b2b_rotate_invite($1, $2, $3) AS r", [u.adminA, res.invite_id, hash(fresh)])).rows[0].r))
      .toMatchObject({ ok: true, email: "rot@x.in" });
    expect(await accept(tokens[2], await createUser(db))).toMatchObject({ ok: false, reason: "INVALID" });
    expect(await accept(fresh, await createUser(db))).toMatchObject({ ok: true });
  });
});

describe("visibility", () => {
  it("staff read their org's invites; students, other orgs and anon cannot", async () => {
    const total = (await one<{ n: number }>("SELECT count(*)::int AS n FROM org_invites WHERE org_id = $1", [org.a])).n;
    for (const who of [u.adminA, u.trainerA]) {
      await asUser(db, who, async (tx) => {
        expect((await tx.query("SELECT * FROM org_invites WHERE org_id = $1", [org.a])).rows).toHaveLength(total);
        expect((await tx.query("UPDATE org_invites SET status = 'revoked' WHERE org_id = $1", [org.a])).affectedRows ?? 0).toBe(0);
      });
    }
    for (const who of [u.adminB, u.existingStudent, null]) {
      await asUser(db, who, async (tx) => expect((await tx.query("SELECT * FROM org_invites WHERE org_id = $1", [org.a])).rows).toEqual([]));
    }
  });

  it("students see only their own consent", async () => {
    const { rows, tokens } = rowsFor([{ row: 2, name: "Consent Viewer", email: "cv@x.in", roll: "CV1" }]);
    await importRows(u.adminA, org.a, rows);
    const s = await createUser(db);
    await accept(tokens[2], s);
    await asUser(db, s, async (tx) => {
      const rowsSeen = (await tx.query<{ user_id: string }>("SELECT user_id FROM org_consents")).rows;
      expect(rowsSeen.map((r) => r.user_id)).toEqual([s]);
    });
    await asUser(db, u.adminB, async (tx) => expect((await tx.query("SELECT * FROM org_consents")).rows).toEqual([]));
  });
});
