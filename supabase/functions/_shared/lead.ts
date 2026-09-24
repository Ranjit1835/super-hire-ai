// ─── Public readiness test: lead validation + consent (pure TS) ─────────────
// Shared by the /test/{slug} form and the b2b-public-test function.

export const PUBLIC_TEST_CONSENT_VERSION = "public-test-2026-09-v1";

export function publicTestConsentText(orgName: string): string {
  return (
    `I agree that ${orgName} may contact me by phone, WhatsApp or email about its courses, and that HiResume ` +
    `records and scores my answers with AI to prepare this readiness report, which is shared with ${orgName}.`
  );
}

/** Accepts "98765 43210", "+91-98765-43210", "09876543210", "919876543210" → "+919876543210". */
export function normalizeIndianMobile(input: string): string | null {
  let d = input.replace(/[^\d]/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export interface LeadInput { full_name: string; phone: string; email: string; target_course?: string }
export interface CleanLead { full_name: string; phone: string; email: string; target_course: string | null }
export type LeadErrors = Partial<Record<keyof LeadInput, string>>;

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function validateLead(input: Partial<LeadInput>): { lead: CleanLead | null; errors: LeadErrors } {
  const errors: LeadErrors = {};
  const name = String(input.full_name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) errors.full_name = "Please enter your name";
  else if (name.length > 100) errors.full_name = "Name is too long";
  const phone = normalizeIndianMobile(String(input.phone ?? ""));
  if (!phone) errors.phone = "Enter a 10-digit Indian mobile number";
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email address";
  const course = String(input.target_course ?? "").replace(/\s+/g, " ").trim();
  if (course.length > 100) errors.target_course = "Keep this under 100 characters";
  if (Object.keys(errors).length) return { lead: null, errors };
  return { lead: { full_name: name, phone: phone!, email, target_course: course || null }, errors };
}
