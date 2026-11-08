// @vitest-environment node
// 20261104002824_b2c_paid_access.sql: credits for paid interviews, earlier buyers made whole, and paid
// profile columns that only the server can change.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createBaseDb, createUser, asUser, asService, expectRejected, affected, readMigration } from "../helpers/pgdb";

const SHAPE = `
  CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id),
    display_name TEXT, avatar_url TEXT,
    plan_type TEXT DEFAULT 'FREE', plan_expiry_date TIMESTAMPTZ, referral_credits INTEGER DEFAULT 0
  );
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
  CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, payment_type TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE public.resume_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_paid_fix_unlocked BOOLEAN DEFAULT false, paid_fix_unlocked_at TIMESTAMPTZ
  );
`;

let db: PGlite;
const u = { interview: "", combo: "", failed: "", fix: "" };
let comboOld = "", comboNew = "";

const credits = async (user: string) =>
  (await db.query<{ c: number }>("SELECT interview_credits AS c FROM public.profiles WHERE user_id = $1", [user])).rows[0].c;
const useCredit = (user: string) =>
  asService(db, async (tx) =>
    (await tx.query<{ r: boolean }>("SELECT public.use_b2c_interview_credit($1) AS r", [user])).rows[0].r);

beforeAll(async () => {
  db = await createBaseDb();
  await db.exec(SHAPE);
  for (const k of Object.keys(u) as (keyof typeof u)[]) {
    u[k] = await createUser(db);
    await db.query("INSERT INTO public.profiles (user_id) VALUES ($1)", [u[k]]);
  }
  const pay = (user: string, type: string, status = "SUCCESS") =>
    db.query("INSERT INTO public.payments (user_id, payment_type, status) VALUES ($1, $2, $3)", [user, type, status]);
  await pay(u.interview, "AI_INTERVIEW");
  await pay(u.interview, "MOCK_INTERVIEW");
  await pay(u.combo, "COMBO_PLAN");
  await pay(u.failed, "AI_INTERVIEW", "FAILED");
  await pay(u.fix, "RESUME_FIX");
  comboOld = (await db.query<{ id: string }>(
    "INSERT INTO public.resume_analyses (user_id, created_at) VALUES ($1, now() - interval '2 days') RETURNING id", [u.combo])).rows[0].id;
  comboNew = (await db.query<{ id: string }>(
    "INSERT INTO public.resume_analyses (user_id) VALUES ($1) RETURNING id", [u.combo])).rows[0].id;
  await db.exec(readMigration("20261104002824_b2c_paid_access.sql"));
});

describe("earlier buyers", () => {
  it("get a credit per paid interview or combo, and nothing for failed or other payments", async () => {
    expect(await credits(u.interview)).toBe(2);
    expect(await credits(u.combo)).toBe(1);
    expect(await credits(u.failed)).toBe(0);
    expect(await credits(u.fix)).toBe(0);
  });

  it("have their latest resume unlocked for a combo", async () => {
    const rows = (await db.query<{ id: string; is_paid_fix_unlocked: boolean }>(
      "SELECT id, is_paid_fix_unlocked FROM public.resume_analyses WHERE user_id = $1", [u.combo])).rows;
    expect(rows.find((r) => r.id === comboNew)?.is_paid_fix_unlocked).toBe(true);
    expect(rows.find((r) => r.id === comboOld)?.is_paid_fix_unlocked).toBe(false);
  });

  it("can't be granted again by a late webhook", async () => {
    const open = await db.query("SELECT 1 FROM public.payments WHERE status = 'SUCCESS' AND fulfilled_at IS NULL");
    expect(open.rows).toHaveLength(0);
  });
});

describe("interview credits", () => {
  it("are spent one at a time and never go below zero", async () => {
    expect(await useCredit(u.combo)).toBe(true);
    expect(await useCredit(u.combo)).toBe(false);
    expect(await credits(u.combo)).toBe(0);
  });

  it("can't be granted or spent from the browser", async () => {
    await asUser(db, u.fix, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.add_b2c_interview_credit($1)", [u.fix])).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public.use_b2c_interview_credit($1)", [u.fix])).toMatch(/permission denied/);
    });
  });
});

describe("profile columns", () => {
  it("a user can still change their name", async () => {
    await asUser(db, u.fix, async (tx) => {
      expect(await affected(tx, "UPDATE public.profiles SET display_name = 'Ravi' WHERE user_id = $1", [u.fix])).toBe(1);
    });
  });

  it("a user can't give themselves a plan, credits or interviews", async () => {
    await asUser(db, u.fix, async (tx) => {
      for (const set of ["plan_type = 'UNLIMITED'", "plan_expiry_date = now()", "referral_credits = 5", "interview_credits = 5"]) {
        expect(await expectRejected(tx, `UPDATE public.profiles SET ${set} WHERE user_id = $1`, [u.fix])).toMatch(/permission denied/);
      }
    });
  });

  it("edge functions can still write them", async () => {
    await asService(db, async (tx) => {
      expect(await affected(tx, "UPDATE public.profiles SET plan_type = 'COMBO' WHERE user_id = $1", [u.fix])).toBe(1);
    });
  });
});
