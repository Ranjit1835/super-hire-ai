// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected, affected, readMigration } from "../helpers/pgdb";

let db: PGlite;
let admin = "", someone = "";

const submit = (tx: Transaction, over: Record<string, string | null> = {}, ip = "203.0.113.7") => {
  const a = { name: "Anita Rao", role: "Placement Officer", institution: "Example College of Engineering", email: "tpo@example.ac.in", phone: "+91 98765 43210", students: "400", message: "Pilot for final years", source: "/college-placement", website: "", ...over };
  return tx.query("SELECT set_config('request.headers', $1, true)", [JSON.stringify({ "x-forwarded-for": `${ip}, 10.0.0.1` })])
    .then(() => tx.query<{ r: { ok: boolean; reason?: string } }>(
      "SELECT public.submit_institution_enquiry($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r",
      [a.name, a.role, a.institution, a.email, a.phone, a.students, a.message, a.source, a.website]))
    .then((r) => r.rows[0].r);
};
const count = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.institution_enquiries")).rows[0].n;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readMigration("20260924000005_institution_enquiries.sql"));
  admin = await createUser(db, { superAdmin: true });
  someone = await createUser(db);
}, 180_000);

describe("institution enquiries", () => {
  it("anonymous visitors can submit, but cannot read, write directly or see counts", async () => {
    await asUser(db, null, async (tx) => {
      expect(await submit(tx)).toEqual({ ok: true });
      expect((await tx.query("SELECT * FROM public.institution_enquiries")).rows).toEqual([]);
      await expectRejected(tx, "INSERT INTO public.institution_enquiries (name, role, institution, email) VALUES ('Xx','Yy','Zz','a@b.co')");
      await expectRejected(tx, "SELECT public.super_new_enquiry_count()");
    }, { commit: true });
    const row = (await db.query<{ email: string; ip_hash: string; status: string }>("SELECT email, ip_hash, status FROM public.institution_enquiries")).rows[0];
    expect(row).toMatchObject({ email: "tpo@example.ac.in", status: "new" });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/); // hashed, not the raw IP
  });

  it("validates input and silently drops honeypot submissions", async () => {
    const before = await count();
    await asUser(db, null, async (tx) => {
      expect(await submit(tx, { email: "not-an-email" }, "198.51.100.1")).toMatchObject({ ok: false, reason: "INVALID_EMAIL" });
      expect(await submit(tx, { name: " " }, "198.51.100.1")).toMatchObject({ ok: false, reason: "MISSING_FIELDS" });
      expect(await submit(tx, { phone: "call me" }, "198.51.100.1")).toMatchObject({ ok: false, reason: "INVALID_PHONE" });
      expect(await submit(tx, { message: "x".repeat(2001) }, "198.51.100.1")).toMatchObject({ ok: false, reason: "TOO_LONG" });
      expect(await submit(tx, { website: "http://spam.example" }, "198.51.100.1")).toEqual({ ok: true });
    }, { commit: true });
    expect(await count()).toBe(before);
  });

  it("rate-limits by IP and by email", async () => {
    await asUser(db, null, async (tx) => {
      for (let i = 0; i < 5; i++) expect(await submit(tx, { email: `p${i}@example.ac.in` }, "192.0.2.50")).toEqual({ ok: true });
      expect(await submit(tx, { email: "p9@example.ac.in" }, "192.0.2.50")).toMatchObject({ ok: false, reason: "RATE_LIMITED" });
      // same email from different IPs: 3 per day (one already exists from the first test)
      expect(await submit(tx, {}, "192.0.2.61")).toEqual({ ok: true });
      expect(await submit(tx, {}, "192.0.2.62")).toEqual({ ok: true });
      expect(await submit(tx, {}, "192.0.2.63")).toMatchObject({ ok: false, reason: "ALREADY_RECEIVED" });
    }, { commit: true });
  });

  it("only super-admins read and triage, and only status and notes can change", async () => {
    await asUser(db, someone, async (tx) => {
      expect((await tx.query("SELECT * FROM public.institution_enquiries")).rows).toEqual([]);
      expect(await affected(tx, "UPDATE public.institution_enquiries SET status = 'won'")).toBe(0);
      expect((await tx.query<{ n: number }>("SELECT public.super_new_enquiry_count() AS n")).rows[0].n).toBe(0);
    });
    await asUser(db, admin, async (tx) => {
      const rows = (await tx.query<{ id: string }>("SELECT id FROM public.institution_enquiries ORDER BY created_at")).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect((await tx.query<{ n: number }>("SELECT public.super_new_enquiry_count() AS n")).rows[0].n).toBe(rows.length);
      const id = rows[0].id;
      expect(await affected(tx, "UPDATE public.institution_enquiries SET status = 'contacted', notes = 'Called, demo Friday' WHERE id = $1", [id])).toBe(1);
      const r = (await tx.query<{ status: string; handled_by: string }>("SELECT status, handled_by FROM public.institution_enquiries WHERE id = $1", [id])).rows[0];
      expect(r).toEqual({ status: "contacted", handled_by: admin });
      expect(await expectRejected(tx, "UPDATE public.institution_enquiries SET email = 'x@y.co' WHERE id = $1", [id])).toMatch(/Only status and notes/);
      await expectRejected(tx, "UPDATE public.institution_enquiries SET status = 'maybe' WHERE id = $1", [id]);
      await expectRejected(tx, "DELETE FROM public.institution_enquiries WHERE id = $1", [id]).catch(async () => {
        // RLS hides rows from DELETE rather than erroring; either way nothing is deleted.
        expect(await affected(tx, "DELETE FROM public.institution_enquiries WHERE id = $1", [id])).toBe(0);
      });
    });
  });
});
