// Itemised proctoring consent: one item per purpose with what / why / who sees it / retention / contact.
// The exact text shown is stored with its version (b2b_record_consent), so change CONSENT_VERSION when the copy changes.

export const CONSENT_VERSION = "proctor-v1-2026-10";

export type ConsentPurposeV1 = "assessment" | "proctoring_screen" | "proctoring_camera" | "proctoring_audio";

export interface ConsentContext {
  orgName: string;
  retentionDays: number;
  contactEmail: string | null;
  kind: "assessment" | "interview";
  hasAttempt: boolean;
}

export interface ConsentItemV1 { purpose: ConsentPurposeV1; title: string; what: string; why: string; text: string }

export function consentItems(c: ConsentContext): ConsentItemV1[] {
  const who = `Who sees it: authorised staff at ${c.orgName} reviewing this ${c.kind === "interview" ? "interview" : "test"}, and HiResume support only if you ask us to help.`;
  const keep = `How long: ${c.retentionDays} days, then deleted automatically. Scores and the final review stay for ${c.orgName}'s contract period.`;
  const contact = c.contactEmail
    ? `Questions or to withdraw: contact ${c.orgName} at ${c.contactEmail} or privacy@hiresume.in.`
    : `Questions or to withdraw: contact ${c.orgName} or privacy@hiresume.in.`;
  const make = (purpose: ConsentPurposeV1, title: string, what: string, why: string): ConsentItemV1 => ({
    purpose, title, what, why, text: [title, `What: ${what}`, `Why: ${why}`, who, keep, contact].join("\n"),
  });
  const items: ConsentItemV1[] = [];
  if (c.hasAttempt) {
    items.push(make("assessment", "Your test answers",
      "your answers, code, runs and timings, and browser events such as tab switches, copy/paste and leaving full screen.",
      `to score your test and show ${c.orgName} how you worked.`));
  }
  items.push(make("proctoring_screen", "Screen snapshots",
    "still images of your entire screen about every 30 seconds and when you switch away. No continuous video.",
    "so a reviewer can see what was on screen when a flag was raised."));
  items.push(make("proctoring_camera", "Webcam checks and snapshots",
    "webcam still images about every 30 seconds and when a flag is raised. Face checks (no face, more than one face, looking away) run on your device; video frames are not uploaded.",
    "to help confirm you are taking the test yourself. AI flags are only evidence for a human reviewer; nobody is failed on them alone."));
  if (c.kind === "assessment") {
    items.push(make("proctoring_audio", "Microphone: speech detection",
      "whether speech-like sound is heard during the coding test. Audio is analysed on your device and is not recorded or uploaded.",
      "because the coding test should be taken quietly and alone. It can't tell who is speaking; a reviewer decides."));
  }
  return items;
}
