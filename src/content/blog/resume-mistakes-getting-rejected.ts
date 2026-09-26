import type { Article } from "./types";

export const resumeMistakes: Article = {
  slug: "resume-mistakes-getting-rejected",
  category: "Common Mistakes",
  title: "10 Resume Mistakes That Get You Rejected (and How to Fix Each One)",
  seoTitle: "10 Resume Mistakes That Get You Rejected — With Fixes",
  description:
    "The most common reasons resumes get filtered out by ATS or skipped by recruiters — from unreadable layouts to vague bullet points — and exactly how to fix each one.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 9,
  keywords: ["resume mistakes", "why resume rejected", "resume rejected by ATS", "resume errors", "resume tips"],
  body: [
    { type: "p", text: "When applications go unanswered, it is tempting to blame luck. More often, the resume is losing information in the ATS or failing the recruiter’s quick first scan. Here are the ten problems we see most often, in roughly the order they cost people interviews." },

    { type: "h2", text: "1. A layout the ATS can’t read" },
    { type: "p", text: "Two columns, tables, text boxes and icons can scramble or drop your details when the resume is parsed." },
    { type: "p", text: "**Fix:** use one column and standard headings. Test by copying all text from your PDF into Notepad — it should read in order. See the [ATS-friendly resume format](/blog/ats-friendly-resume-format)." },

    { type: "h2", text: "2. Missing the skills the job asks for" },
    { type: "p", text: "Recruiters search for specific tools and skills. “Databases” doesn’t match a search for “MySQL”." },
    { type: "p", text: "**Fix:** use the exact skill names from the job description, where true, in both your skills section and your bullets. Follow the [keyword method](/blog/resume-keywords-optimization)." },

    { type: "h2", text: "3. Duties instead of achievements" },
    { type: "example", bad: "Responsible for handling customer queries.", good: "Resolved 40+ customer queries a day over chat and email, maintaining a 4.7/5 satisfaction score." },
    { type: "p", text: "**Fix:** action verb + what you did + result. See [how to quantify achievements](/blog/quantify-resume-achievements)." },

    { type: "h2", text: "4. A generic objective" },
    { type: "p", text: "“Seeking a challenging position in a reputed organisation” tells the reader nothing and takes the most valuable space on the page." },
    { type: "p", text: "**Fix:** two lines: who you are, your strongest relevant skills, one proof point, and the role you want." },

    { type: "h2", text: "5. Contact details that are hard to find — or wrong" },
    { type: "p", text: "Phone numbers in a footer the ATS ignores, an old college email you no longer check, or a typo in a digit." },
    { type: "p", text: "**Fix:** put name, +91 phone, a professional email, city and LinkedIn at the top of the body. Call your own number from the resume once." },

    { type: "h2", text: "6. Listing skills you can’t discuss" },
    { type: "p", text: "Every skill listed invites questions. Twenty technologies with no projects behind them looks like padding and fails in the interview." },
    { type: "p", text: "**Fix:** list what you can answer questions on; mark lighter exposure as “basic”. Back each key skill with a project or bullet." },

    { type: "h2", text: "7. Spelling, grammar and inconsistent formatting" },
    { type: "p", text: "Mixed date formats, random capitalisation (“java”, “JAVA”, “Java”), and typos signal carelessness — especially for roles that need attention to detail." },
    { type: "p", text: "**Fix:** pick one date format, write tool names the official way, run a spell-check and read the resume aloud once." },

    { type: "h2", text: "8. Too long, or crammed" },
    { type: "p", text: "Freshers with two-page resumes full of school achievements, or experienced candidates with 9-pt text squeezed onto one page." },
    { type: "p", text: "**Fix:** one page for freshers and under ~5 years’ experience; two pages at most beyond that. Cut old and weak points rather than shrinking the font." },

    { type: "h2", text: "9. Unnecessary personal details" },
    { type: "p", text: "Date of birth, religion, marital status, father’s name, full home address and a photo add length and nothing an employer needs to shortlist you." },
    { type: "p", text: "**Fix:** remove them. City is enough for location. Keep the space for skills and projects." },

    { type: "h2", text: "10. One resume for every job" },
    { type: "p", text: "Sending the same resume to a testing role, a developer role and a data role means it is a weak match for all three." },
    { type: "p", text: "**Fix:** keep a master resume, and for each type of role adjust the summary, skill order and top bullets. It takes 10 minutes and makes a real difference." },

    { type: "h2", text: "Find your mistakes in about 15 seconds" },
    { type: "p", text: "HiResume checks your resume for all ten of these — readability, keywords, weak bullets, missing sections — and shows exactly what to change, free." },
    { type: "cta", kind: "ats" },
  ],
  faq: [
    { q: "Why does my resume keep getting rejected?", a: "The most common reasons are a layout the ATS can’t read, missing the exact skills in the job description, bullet points that list duties without results, and applying with the same resume to very different roles." },
    { q: "Should I include a photo on my resume in India?", a: "It isn’t necessary for most private-sector jobs in India and adds nothing an ATS can read. Only add one if the job posting asks for it." },
  ],
};
