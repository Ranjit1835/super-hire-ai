/**
 * Extended types for Supabase tables that include columns not yet in the
 * auto-generated types.ts. Import from here instead of modifying types.ts.
 */

export type PlanType = "FREE" | "COMBO" | "UNLIMITED";

export interface ProfileRow {
  user_id: string;
  early_bird_active: boolean | null;
  early_bird_expiry_date: string | null;
  plan_type: PlanType | null;
  plan_expiry_date: string | null;
  monthly_resume_count: number | null;
  last_resume_reset_date: string | null;
  monthly_interview_count: number | null;
  last_interview_reset_date: string | null;
  total_payments: number | null;
  first_time_fix_used: boolean | null;
  first_time_early_bird_used: boolean | null;
}

/** Returns true if the profile has an active unlimited or combo plan. */
export function hasActivePlan(profile: Partial<ProfileRow>): boolean {
  if (!profile.plan_type || profile.plan_type === "FREE") return false;
  if (!profile.plan_expiry_date) return false;
  return new Date(profile.plan_expiry_date) > new Date();
}

/** Returns true if the early bird access is still valid (legacy compat). */
export function isEarlyBirdActive(profile: Partial<ProfileRow>): boolean {
  return !!(
    profile.early_bird_active &&
    profile.early_bird_expiry_date &&
    new Date(profile.early_bird_expiry_date) > new Date()
  );
}

/** Human-readable label for a plan type. */
export function planLabel(plan: PlanType | null | undefined): string {
  switch (plan) {
    case "UNLIMITED": return "Unlimited";
    case "COMBO": return "Combo";
    default: return "Free";
  }
}
