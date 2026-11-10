// @vitest-environment node
// DPDP consent records and account deletion (20261110000001_privacy_consent_and_erasure.sql) on embedded Postgres.
// The B2C tables are created here in their real shape (columns the function touches); cron is stubbed.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createBaseDb, createUser, asUser, asService, readMigration } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const count = async (sql: string, params: unknown[]) => (await db.query<{ n: number }>(sql, params)).rows[0].n;
const del = (user: string) =>
  asService(db, async (tx) => (await tx.query<{ r: { ok: boolean; reason?: string } }>("SELECT public.privacy_delete_account($1) AS r", [user])).rows[0].r);

const B2C = `
  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE OR REPLACE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
  CREATE TABLE public.org_memberships (org_id uuid, user_id uuid, role text);
  CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, payment_type text,
    amount int, currency text, razorpay_order_id text, razorpay_payment_id text, razorpay_signature text, status text,
    created_at timestamptz DEFAULT now());
  CREATE TABLE public.interview_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
  CREATE TABLE public.user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
  CREATE TABLE public.resume_builders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
  CREATE TABLE public.otp_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
  CREATE TABLE public.guest_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claimed_by uuid);
  CREATE TABLE public.login_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
`;

beforeAll(async () => {
  db = await createBaseDb();
  await db.exec(B2C);
  await db.exec(readMigration("20261110000001_privacy_consent_and_erasure.sql"));
  u.a = await createUser(db);
  u.b = await createUser(db);
  u.member = await createUser(db);
  u.super = await createUser(db, { superAdmin: true });
  await db.query("INSERT INTO org_memberships VALUES (gen_random_uuid(), $1, 'student')", [u.member]);
  const email = (await db.query<{ email: string }>("SELECT email FROM auth.users WHERE id = $1", [u.a])).rows[0].email;
  for (const t of ["interview_sessions", "user_sessions", "resume_builders", "otp_codes"]) {
    await db.query(`INSERT INTO ${t} (user_id) VALUES ($1), ($2)`, [u.a, u.b]);
  }
  await db.query("INSERT INTO payments (user_id, payment_type, amount, razorpay_signature, status) VALUES ($1, 'interview', 99, 'sig', 'paid'), ($2, 'fix', 49, 'sig', 'paid')", [u.a, u.b]);
  await db.query("INSERT INTO guest_analyses (claimed_by) VALUES ($1), ($2)", [u.a, u.b]);
  await db.query("INSERT INTO login_attempts (email) VALUES ($1), ('someone@else.in')", [email.toUpperCase()]);
}, 120_000);

describe("consent records", () => {
  it("a user records and reads only their own consent, with the version and text", async () => {
    await asUser(db, u.a, (tx) => tx.query(
      "INSERT INTO user_consents (user_id, purpose, notice_version, consent_text) VALUES ($1, 'privacy_notice', '2026-11-10', 'I agree to the privacy notice.')", [u.a]), { commit: true });
    const own = await asUser(db, u.a, async (tx) => (await tx.query("SELECT purpose FROM user_consents")).rows);
    expect(own).toEqual([{ purpose: "privacy_notice" }]);
    expect(await asUser(db, u.b, async (tx) => (await tx.query("SELECT * FROM user_consents")).rows)).toEqual([]);
  });

  it("nobody records consent for someone else, or backdates it", async () => {
    await expect(asUser(db, u.b, (tx) => tx.query(
      "INSERT INTO user_consents (user_id, purpose, notice_version, consent_text) VALUES ($1, 'age_18_plus', 'v', 'I am 18 or older.')", [u.a]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, u.b, (tx) => tx.query(
      "INSERT INTO user_consents (user_id, purpose, notice_version, consent_text, granted_at) VALUES ($1, 'age_18_plus', 'v', 'I am 18 or older.', now() - interval '1 year')", [u.b]))).rejects.toThrow(/row-level security/);
  });
});

describe("account deletion", () => {
  it("refuses college/company members and super admins", async () => {
    expect(await del(u.member)).toEqual({ ok: false, reason: "B2B_MEMBER" });
    expect(await del(u.super)).toEqual({ ok: false, reason: "SUPER_ADMIN" });
  });

  it("clears every table keyed by the user and keeps payments only in the restricted store", async () => {
    expect(await del(u.a)).toEqual({ ok: true });
    for (const t of ["payments", "interview_sessions", "user_sessions", "resume_builders", "otp_codes"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.a])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.b])).toBe(1);   // others untouched
    }
    expect(await count("SELECT count(*)::int AS n FROM guest_analyses WHERE claimed_by = $1", [u.a])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM login_attempts", [])).toBe(1);
    const kept = (await db.query<{ amount: number; sig: string | null; years: number }>(
      "SELECT (record->>'amount')::int AS amount, record->>'razorpay_signature' AS sig, extract(year FROM age(delete_after, account_deleted_at))::int AS years FROM retained_payment_records WHERE user_id = $1", [u.a])).rows;
    expect(kept).toEqual([{ amount: 99, sig: null, years: 8 }]);
  });

  it("the restricted store and the delete function are closed to signed-in users", async () => {
    await expect(asUser(db, u.b, (tx) => tx.query("SELECT * FROM retained_payment_records"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.b, (tx) => tx.query("SELECT public.privacy_delete_account($1)", [u.b]))).rejects.toThrow(/permission denied/);
  });
});
