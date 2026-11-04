// @vitest-environment node
// Every product on sale must deliver something once paid for, whichever of verify-payment and the
// webhook gets there first. Interview and Combo buyers used to pay and receive nothing.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fulfilPayment, type FulfilablePayment } from "../../functions/_shared/fulfil-payment";

type Row = Record<string, unknown>;

function fakeAdmin(failRpc = false) {
  const tables: Record<string, Row[]> = {
    payments: [{ id: "pay", fulfilled_at: null }],
    profiles: [{ user_id: "u", interview_credits: 0, total_payments: 0, plan_type: "FREE" }],
    resume_analyses: [{ id: "resume", is_paid_fix_unlocked: false }],
    resume_builders: [{ id: "build", is_paid: false }],
  };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const run = () => {
      const rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      return rows;
    };
    const q = {
      update(v: Row) { patch = v; return q; },
      select() { return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return q; },
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then(resolve: (v: { data: Row[]; error: null }) => void) { resolve({ data: run(), error: null }); },
    };
    return q;
  };
  const rpc = async (name: string, args: { p_user_id: string }) => {
    if (failRpc) return { data: null, error: { message: "db down" } };
    expect(name).toBe("add_b2c_interview_credit");
    const profile = tables.profiles.find((p) => p.user_id === args.p_user_id)!;
    profile.interview_credits = (profile.interview_credits as number) + 1;
    return { data: null, error: null };
  };
  return { from, rpc, tables };
}

const paymentOf = (payment_type: string): FulfilablePayment => ({
  id: "pay", user_id: "u", payment_type, resume_analysis_id: "resume", resume_builder_id: "build",
});

describe("fulfilPayment", () => {
  it("gives an interview purchase one credit", async () => {
    const admin = fakeAdmin();
    expect(await fulfilPayment(admin, paymentOf("AI_INTERVIEW"))).toBe(true);
    expect(admin.tables.profiles[0].interview_credits).toBe(1);
    expect(admin.tables.resume_analyses[0].is_paid_fix_unlocked).toBe(false);
  });

  it("gives a combo both the resume fix and an interview", async () => {
    const admin = fakeAdmin();
    await fulfilPayment(admin, paymentOf("COMBO_PLAN"));
    expect(admin.tables.resume_analyses[0].is_paid_fix_unlocked).toBe(true);
    expect(admin.tables.profiles[0].interview_credits).toBe(1);
  });

  it("gives a resume fix no interview", async () => {
    const admin = fakeAdmin();
    await fulfilPayment(admin, paymentOf("RESUME_FIX"));
    expect(admin.tables.resume_analyses[0].is_paid_fix_unlocked).toBe(true);
    expect(admin.tables.profiles[0].interview_credits).toBe(0);
    expect(admin.tables.profiles[0].first_time_fix_used).toBe(true);
  });

  it("gives Unlimited a year", async () => {
    const admin = fakeAdmin();
    await fulfilPayment(admin, paymentOf("UNLIMITED_PLAN"), new Date("2026-11-04T00:00:00Z"));
    expect(admin.tables.profiles[0].plan_type).toBe("UNLIMITED");
    expect(admin.tables.profiles[0].plan_expiry_date).toBe("2027-11-04T00:00:00.000Z");
  });

  it("grants once when verify-payment and the webhook both run", async () => {
    const admin = fakeAdmin();
    const results = [await fulfilPayment(admin, paymentOf("AI_INTERVIEW")), await fulfilPayment(admin, paymentOf("AI_INTERVIEW"))];
    expect(results).toEqual([true, false]);
    expect(admin.tables.profiles[0].interview_credits).toBe(1);
    expect(admin.tables.profiles[0].total_payments).toBe(1);
  });

  it("releases the claim when granting fails, so a retry can still deliver", async () => {
    const admin = fakeAdmin(true);
    await expect(fulfilPayment(admin, paymentOf("AI_INTERVIEW"))).rejects.toThrow("db down");
    expect(admin.tables.payments[0].fulfilled_at).toBeNull();
  });

  it("delivers something for every product create-payment-order sells", async () => {
    const source = readFileSync(join(__dirname, "../../functions/create-payment-order/index.ts"), "utf8");
    const list = source.match(/if \(!\[([\s\S]*?)\]\.includes\(paymentType\)\)/)?.[1] ?? "";
    const types = [...list.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(5);

    for (const type of types.filter((t) => !t.startsWith("STUDIO_"))) { // Studio: studio-create-session
      const admin = fakeAdmin();
      await fulfilPayment(admin, paymentOf(type));
      const delivered =
        admin.tables.resume_analyses[0].is_paid_fix_unlocked === true ||
        admin.tables.resume_builders[0].is_paid === true ||
        admin.tables.profiles[0].plan_type === "UNLIMITED" ||
        admin.tables.profiles[0].interview_credits === 1;
      expect(delivered, `${type} delivers nothing`).toBe(true);
    }
    expect(types).toEqual(expect.arrayContaining(["STUDIO_SINGLE", "STUDIO_WEEKLY", "STUDIO_YEARLY"]));
  });
});
