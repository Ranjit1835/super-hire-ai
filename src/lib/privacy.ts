// One place for the privacy contact and notice version (DPDP Act 2023 / Rules 2025). The notice page, the sign-up
// consent and the account page all read these, so a change here changes every surface together.

/** Where privacy requests and complaints go. hiresume.in must receive mail (MX records) for this to work. */
export const PRIVACY_EMAIL = "privacy@hiresume.in";

/** The named person who answers privacy requests and decides on breaches. Owner to confirm the name. */
export const GRIEVANCE_OFFICER = "Grievance Officer, HiResume";

/** Bump when the notice changes in substance; stored with every consent so we know which text a user agreed to. */
export const PRIVACY_NOTICE_VERSION = "2026-11-10";

/** We answer privacy requests well inside the 90-day limit the Rules set. */
export const PRIVACY_RESPONSE_DAYS = 30;

/** B2C accounts are for adults only (owner decision 2026-11-09): DPDP treats under-18s as children. */
export const MIN_AGE = 18;
