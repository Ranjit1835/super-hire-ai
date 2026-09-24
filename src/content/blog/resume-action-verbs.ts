import type { Article } from "./types";

// 10 groups × 16 verbs = 160 (checked by src/content/blog/blog.test.ts).
export const ACTION_VERB_GROUPS: { name: string; verbs: string[] }[] = [
  { name: "Building and creating", verbs: ["Built", "Developed", "Designed", "Created", "Engineered", "Implemented", "Launched", "Prototyped", "Programmed", "Architected", "Deployed", "Integrated", "Configured", "Automated", "Coded", "Assembled"] },
  { name: "Improving", verbs: ["Improved", "Optimised", "Reduced", "Increased", "Accelerated", "Streamlined", "Refactored", "Upgraded", "Enhanced", "Simplified", "Modernised", "Strengthened", "Restructured", "Revamped", "Stabilised", "Standardised"] },
  { name: "Analysing and research", verbs: ["Analysed", "Evaluated", "Investigated", "Measured", "Tested", "Assessed", "Researched", "Modelled", "Forecasted", "Audited", "Diagnosed", "Examined", "Identified", "Quantified", "Validated", "Benchmarked"] },
  { name: "Leading and managing", verbs: ["Led", "Managed", "Coordinated", "Directed", "Supervised", "Organised", "Planned", "Delegated", "Headed", "Oversaw", "Prioritised", "Scheduled", "Spearheaded", "Chaired", "Mobilised", "Orchestrated"] },
  { name: "Communicating", verbs: ["Presented", "Wrote", "Documented", "Explained", "Negotiated", "Persuaded", "Published", "Reported", "Briefed", "Authored", "Edited", "Translated", "Pitched", "Promoted", "Corresponded", "Summarised"] },
  { name: "Helping and supporting", verbs: ["Supported", "Resolved", "Assisted", "Guided", "Mentored", "Trained", "Coached", "Onboarded", "Advised", "Facilitated", "Served", "Troubleshot", "Answered", "Clarified", "Educated", "Tutored"] },
  { name: "Achieving results", verbs: ["Achieved", "Delivered", "Exceeded", "Won", "Completed", "Secured", "Earned", "Generated", "Attained", "Surpassed", "Grew", "Doubled", "Saved", "Captured", "Closed", "Ranked"] },
  { name: "Working with data", verbs: ["Cleaned", "Collected", "Compiled", "Extracted", "Mapped", "Migrated", "Processed", "Queried", "Scraped", "Structured", "Tracked", "Visualised", "Aggregated", "Transformed", "Catalogued", "Indexed"] },
  { name: "Starting and initiating", verbs: ["Initiated", "Founded", "Established", "Introduced", "Pioneered", "Proposed", "Instituted", "Conceived", "Formed", "Started", "Devised", "Formulated", "Originated", "Piloted", "Set up", "Kick-started"] },
  { name: "Sales, marketing and operations", verbs: ["Acquired", "Converted", "Expanded", "Marketed", "Sourced", "Procured", "Retained", "Upsold", "Campaigned", "Merchandised", "Dispatched", "Inventoried", "Fulfilled", "Budgeted", "Reconciled", "Allocated"] },
];

const total = ACTION_VERB_GROUPS.reduce((n, g) => n + g.verbs.length, 0);

export const resumeActionVerbs: Article = {
  slug: "resume-action-verbs",
  category: "Resume Tips",
  title: `${total}+ Resume Action Verbs (Grouped, With Example Bullets)`,
  seoTitle: `${total}+ Resume Action Verbs With Examples`,
  description:
    "Strong action verbs to replace “responsible for” on your resume, grouped by what you did — building, improving, analysing, leading — with before-and-after examples.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 5,
  keywords: ["resume action verbs", "action words for resume", "power words resume", "resume verbs", "responsible for synonyms"],
  body: [
    { type: "p", text: "Recruiters skim. The first word of each bullet tells them what you actually did. “Responsible for”, “worked on” and “helped with” describe a job title, not a contribution. A precise action verb followed by a result is what makes a bullet worth reading." },
    { type: "example", bad: "Responsible for the college website.", good: "**Rebuilt** the college website in React, **cutting** page load time from 6s to 1.8s and **doubling** online admission enquiries." },

    { type: "h2", text: "How to use action verbs well" },
    { type: "ul", items: [
      "**Start every bullet with a verb** — past tense for past roles, present tense for your current one.",
      "**Pick the most precise verb.** “Automated” says more than “Worked on”; “Negotiated” says more than “Handled”.",
      "**Don’t repeat the same verb** more than twice on the page.",
      "**Follow the verb with what + how + result:** Verb → task → tools → number.",
      "**Stay honest.** “Led” means you led. If you contributed, say “Built the payments module for…” instead.",
    ] },

    ...ACTION_VERB_GROUPS.flatMap((g) => [
      { type: "h3" as const, text: `${g.name} (${g.verbs.length})` },
      { type: "p" as const, text: g.verbs.join(" · ") },
    ]),

    { type: "h2", text: "Before and after" },
    { type: "table", head: ["Weak", "Strong"], rows: [
      ["Worked on a machine learning project.", "Trained a random-forest model on 50k loan records, reaching 87% accuracy — 9 points above the logistic-regression baseline."],
      ["Helped organise the tech fest.", "Coordinated 14 volunteers and 6 sponsors for a 2-day tech fest with 1,200 participants."],
      ["Did testing for the app.", "Wrote 90 API tests in Postman, catching 11 defects before the release."],
      ["Handled social media.", "Grew the club’s Instagram from 800 to 4,500 followers in 6 months with a weekly reels calendar."],
      ["Was part of a team that made a chatbot.", "Built the intent-classification module for a college FAQ chatbot answering 300+ queries a week."],
    ] },

    { type: "h2", text: "Verbs to avoid or use sparingly" },
    { type: "p", text: "“Responsible for”, “worked on”, “helped”, “handled”, “involved in”, “participated in”, “assisted with” (unless the assistance is the point), and buzzwords like “synergised” or “leveraged” when a plain verb would do." },

    { type: "h2", text: "Let AI find your weak bullets" },
    { type: "p", text: "HiResume highlights bullets that start weakly or lack a result and suggests stronger versions based on what you actually did. Pair verbs with numbers using our guide to [quantifying achievements](/blog/quantify-resume-achievements)." },
    { type: "cta", kind: "ats" },
  ],
  faq: [
    { q: "What can I write instead of “responsible for” on a resume?", a: "Use a verb that says what you did: Managed, Built, Led, Improved, Resolved, Coordinated or Delivered — followed by the task and a result, e.g. “Managed a ₹2 lakh event budget for…”." },
    { q: "Should resume bullets be in past tense?", a: "Use past tense for previous roles and projects, and present tense for a job you are currently doing." },
  ],
};
