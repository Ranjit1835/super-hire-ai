// Consent wording shown at invite acceptance / public test. Shared by the edge
// function (which stores the exact text) and the UI (which displays it).
// Bump the version whenever the wording changes.
export const B2B_CONSENT_VERSION = "b2b-consent-2026-09-v1";

export function b2bConsentText(orgName: string): string {
  return (
    `I agree that HiResume may record the transcript and timing of my practice interviews, ` +
    `score them with AI, and share my reports and scores with ${orgName} for skill assessment ` +
    `and placement preparation. My data will not be sold or shown to employers without my permission.`
  );
}

// Staff (TPO admin, trainer, recruiter, hiring manager) accept a confidentiality undertaking, not the
// student/candidate consent: their own data isn't assessed.
export const B2B_STAFF_CONSENT_VERSION = "b2b-staff-2026-10-v1";
export const B2B_STAFF_ROLES = ["org_admin", "trainer", "recruiter", "hiring_manager"];

export function b2bStaffConsentText(orgName: string, orgType: string): string {
  const people = orgType === "company" ? "candidate" : "student";
  const work = orgType === "company" ? "hiring" : "placement";
  return (
    `I will use the ${people} information I see in ${orgName}'s HiResume portal only for ${orgName}'s ${work} work ` +
    `and keep it confidential. I understand that my actions in the portal are logged.`
  );
}

/** The consent an invite asks for: staff undertaking for staff roles, the student consent otherwise. */
export function inviteConsent(role: string | null, org: { name: string; type: string }): { version: string; text: string } {
  return role && B2B_STAFF_ROLES.includes(role)
    ? { version: B2B_STAFF_CONSENT_VERSION, text: b2bStaffConsentText(org.name, org.type) }
    : { version: B2B_CONSENT_VERSION, text: b2bConsentText(org.name) };
}
