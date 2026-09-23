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
