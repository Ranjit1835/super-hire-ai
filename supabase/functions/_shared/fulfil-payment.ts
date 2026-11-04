// What a successful payment grants. Both verify-payment (the browser came back) and razorpay-webhook
// (the browser closed, or the webhook won the race) run this, so the two can't drift apart. They can
// also run at the same moment: the fulfilled_at claim means only the first caller grants anything.
// Studio passes aren't here: studio-create-session creates the session because it needs the resume id.

export interface FulfilablePayment {
  id: string;
  user_id: string;
  payment_type: string;
  resume_analysis_id?: string | null;
  resume_builder_id?: string | null;
}

const FIX_TYPES = new Set(["ONE_TIME_FIX", "RESUME_FIX", "COMBO_PLAN"]);
const BUILD_TYPES = new Set(["RESUME_BUILDER", "RESUME_BUILD"]);
const YEAR_PLAN_TYPES = new Set(["EARLY_BIRD_ACCESS", "UNLIMITED_PLAN"]);
const INTERVIEW_TYPES = new Set(["AI_INTERVIEW", "MOCK_INTERVIEW", "COMBO_PLAN"]);

function check(result: { error?: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

// deno-lint-ignore no-explicit-any
async function grant(admin: any, payment: FulfilablePayment, now: Date) {
  const type = payment.payment_type;

  if (FIX_TYPES.has(type) && payment.resume_analysis_id) {
    check(await admin.from("resume_analyses").update({
      is_paid_fix_unlocked: true,
      paid_fix_unlocked_at: now.toISOString(),
    }).eq("id", payment.resume_analysis_id));
  }

  if (BUILD_TYPES.has(type) && payment.resume_builder_id) {
    check(await admin.from("resume_builders").update({
      is_paid: true,
      paid_at: now.toISOString(),
    }).eq("id", payment.resume_builder_id));
  }

  if (YEAR_PLAN_TYPES.has(type)) {
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + 365);
    check(await admin.from("profiles").update({
      plan_type: "UNLIMITED",
      plan_expiry_date: expiry.toISOString(),
      early_bird_active: true,
      early_bird_expiry_date: expiry.toISOString(),
    }).eq("user_id", payment.user_id));
  }

  if (type === "COMBO_PLAN") {
    check(await admin.from("profiles").update({ plan_type: "COMBO" }).eq("user_id", payment.user_id));
  }

  if (INTERVIEW_TYPES.has(type)) {
    check(await admin.rpc("add_b2c_interview_credit", { p_user_id: payment.user_id }));
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("total_payments, first_time_fix_used, first_time_early_bird_used")
    .eq("user_id", payment.user_id)
    .single();

  const profileUpdate: Record<string, unknown> = { total_payments: (profile?.total_payments || 0) + 1 };
  if ((type === "ONE_TIME_FIX" || type === "RESUME_FIX") && !profile?.first_time_fix_used) {
    profileUpdate.first_time_fix_used = true;
  }
  if (YEAR_PLAN_TYPES.has(type) && !profile?.first_time_early_bird_used) {
    profileUpdate.first_time_early_bird_used = true;
  }
  check(await admin.from("profiles").update(profileUpdate).eq("user_id", payment.user_id));
}

/** Grant what this payment bought. Returns false when another caller already did. */
// deno-lint-ignore no-explicit-any
export async function fulfilPayment(admin: any, payment: FulfilablePayment, now = new Date()): Promise<boolean> {
  const { data: claimed, error } = await admin
    .from("payments")
    .update({ fulfilled_at: now.toISOString() })
    .eq("id", payment.id)
    .is("fulfilled_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!claimed) return false;

  try {
    await grant(admin, payment, now);
  } catch (e) {
    // Release the claim so a retry (Razorpay redelivers webhooks) can still deliver what was paid for.
    await admin.from("payments").update({ fulfilled_at: null }).eq("id", payment.id);
    throw e;
  }
  return true;
}
