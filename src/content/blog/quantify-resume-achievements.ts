import type { Article } from "./types";

const EXAMPLES: { name: string; items: string[] }[] = [
  { name: "Students, projects and college", items: [
    "Built a library management app in Java and MySQL used by 250+ students across 2 semesters.",
    "Ranked 3rd of 120 teams in a 36-hour hackathon with a crop-price prediction app.",
    "Organised a 2-day tech fest for 1,200 participants with a ₹3 lakh sponsorship budget.",
    "Taught weekly Python sessions to 40 juniors; 28 completed the club’s certification.",
    "Scraped and cleaned 30,000 product listings for a price-comparison project.",
    "Reduced a sorting assignment’s runtime from 12s to 0.8s by switching to a heap.",
    "Grew the coding club’s WhatsApp community from 150 to 900 members in one year.",
    "Published a paper on IoT irrigation at a national conference (1 of 40 accepted).",
  ] },
  { name: "Software development", items: [
    "Cut API response time from 800 ms to 180 ms by adding Redis caching for the top 5 endpoints.",
    "Shipped 14 features across 6 releases for an app with 50,000 monthly users.",
    "Reduced crash rate from 2.1% to 0.4% after fixing memory leaks in the image upload flow.",
    "Wrote 300+ unit tests, raising coverage from 35% to 78%.",
    "Automated deployments with GitHub Actions, reducing release time from 2 hours to 15 minutes.",
    "Migrated 40 legacy pages from jQuery to React with no downtime.",
    "Resolved 60+ production tickets in 3 months with a 1-day average turnaround.",
  ] },
  { name: "Data and analytics", items: [
    "Built a Power BI dashboard that replaced 6 weekly Excel reports, saving ~10 hours a week.",
    "Cleaned 1.2 lakh customer records, reducing duplicates by 18%.",
    "Identified a pricing error through SQL analysis that recovered ₹4.5 lakh in revenue.",
    "Forecast monthly demand within 7% error using a seasonal model.",
    "Automated a daily MIS report with Python, cutting preparation time from 3 hours to 10 minutes.",
    "Analysed 9,000 survey responses to find the 3 factors behind 70% of complaints.",
    "Designed an A/B test on checkout copy that lifted conversion by 4.2%.",
  ] },
  { name: "Sales and marketing", items: [
    "Exceeded quarterly sales target by 128% (₹38 lakh against ₹30 lakh).",
    "Generated 450 qualified leads in 2 months through LinkedIn outreach.",
    "Grew organic website traffic from 3,000 to 21,000 monthly visits in 8 months with SEO.",
    "Reduced cost per lead on Meta Ads from ₹210 to ₹95 by restructuring campaigns.",
    "Increased email open rates from 14% to 31% by segmenting the list.",
    "Signed 12 new B2B clients, including 3 enterprise accounts.",
    "Ran 20 campus ambassador events, bringing in 2,300 app sign-ups.",
  ] },
  { name: "Operations and customer support", items: [
    "Handled 60+ customer tickets a day with a 94% first-contact resolution rate.",
    "Reduced order dispatch time from 48 to 20 hours by reorganising the packing line.",
    "Cut inventory mismatch from 6% to under 1% with weekly cycle counts.",
    "Negotiated vendor contracts that saved ₹6 lakh a year.",
    "Maintained a 4.8/5 customer satisfaction score across 1,500+ chats.",
    "Onboarded 35 new retail partners in one quarter.",
    "Brought SLA breaches down from 11% to 3% by introducing a triage queue.",
  ] },
  { name: "HR, finance and administration", items: [
    "Coordinated hiring for 25 roles in 3 months, reducing time-to-hire from 40 to 26 days.",
    "Processed monthly payroll for 180 employees with zero errors over 12 months.",
    "Reconciled ₹2.3 crore of vendor payments and closed books 3 days earlier each month.",
    "Ran onboarding for 60 freshers, with 95% completing training in the first week.",
    "Digitised 4,000 employee files, cutting document retrieval from hours to minutes.",
    "Reduced travel expenses by 15% through a new booking policy.",
    "Organised 8 compliance trainings attended by 300+ staff.",
  ] },
  { name: "Leadership and teamwork", items: [
    "Led a team of 5 to deliver the final-year project 2 weeks ahead of schedule.",
    "Mentored 4 interns, 3 of whom received full-time offers.",
    "Introduced daily 15-minute stand-ups, cutting blocked tasks by half.",
    "Coordinated work across 3 teams to launch a feature used by 10,000 users in its first week.",
    "Managed a ₹1.5 lakh budget for the annual cultural fest with 8% left unspent.",
    "Trained 12 support staff on a new CRM within 2 weeks.",
    "Resolved a 3-month backlog of 400 requests by reorganising team shifts.",
  ] },
];

const count = EXAMPLES.reduce((n, g) => n + g.items.length, 0);

export const quantifyResumeAchievements: Article = {
  slug: "quantify-resume-achievements",
  category: "Resume Tips",
  title: `How to Quantify Achievements on Your Resume (${count} Examples)`,
  seoTitle: `Quantify Resume Achievements: ${count} Examples`,
  description:
    "A simple formula for turning vague resume bullets into measurable achievements, what to measure when you don’t have sales numbers, and examples for every field.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 8,
  keywords: ["quantify achievements resume", "resume achievements examples", "measurable results resume", "resume bullet points examples", "accomplishments on resume"],
  body: [
    { type: "p", text: "Numbers make a recruiter stop skimming. “Improved the website” could mean anything; “cut page load time from 6 seconds to 1.8” is specific, believable and memorable. You don’t need to be in sales to have numbers — almost every kind of work can be measured in time, volume, quality, money or people." },

    { type: "h2", text: "The formula" },
    { type: "p", text: "**Action verb + what you did + how (tools/method) + result (number).**" },
    { type: "example", bad: "Worked on improving the college attendance system.", good: "**Rebuilt** the attendance system in **Django**, cutting daily marking time for 40 faculty from 20 minutes to 3." },

    { type: "h2", text: "What to measure when you think you have no numbers" },
    { type: "table", head: ["Measure", "Ask yourself", "Example"], rows: [
      ["Scale / volume", "How many? How often?", "40 tickets a day, 12,000 records, 250 users"],
      ["Time", "Faster? How much time saved?", "3 hours → 10 minutes; 2 weeks early"],
      ["Money", "Revenue, savings, budget?", "Saved ₹6 lakh a year; managed a ₹1.5 lakh budget"],
      ["Quality", "Fewer errors? Better scores?", "Defects down 40%; 4.8/5 rating"],
      ["People", "How many led, trained, served?", "Mentored 4 interns; event for 1,200 people"],
      ["Rank / selection", "Compared to how many?", "3rd of 120 teams; 1 of 40 selected"],
    ] },
    { type: "tip", title: "Estimates are fine — inventions are not", text: "If you don’t have an exact figure, a reasonable, defensible estimate is fine (“~10 hours a week”). Never invent numbers: interviewers ask “How did you measure that?”, and you need a good answer." },

    { type: "h2", text: `${count} examples by field` },
    ...EXAMPLES.flatMap((g) => [
      { type: "h3" as const, text: g.name },
      { type: "ul" as const, items: g.items },
    ]),

    { type: "h2", text: "Three quick checks for every bullet" },
    { type: "ol", items: [
      "**Does it start with a strong verb?** See our list of [action verbs](/blog/resume-action-verbs).",
      "**Is there a number or a clear outcome?** If not, ask: how many, how much, how fast, compared to what?",
      "**Would you be comfortable explaining it in an interview?** If not, rewrite it.",
    ] },

    { type: "h2", text: "Find the bullets that need numbers" },
    { type: "p", text: "HiResume flags bullets without measurable impact and suggests how to strengthen each one — free, in about 15 seconds." },
    { type: "cta", kind: "ats" },
  ],
  faq: [
    { q: "How do I quantify achievements with no work experience?", a: "Measure your projects, internships and activities: number of users, size of data, time saved, marks or ranks, number of people in events you organised, or improvements you made (for example faster load time)." },
    { q: "Is it okay to estimate numbers on a resume?", a: "Yes, if the estimate is reasonable and you can explain how you arrived at it. Use “~” or “about” for estimates, and never invent figures." },
  ],
};
