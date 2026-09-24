import type { Article } from "./types";

export const resumeKeywordsOptimization: Article = {
  slug: "resume-keywords-optimization",
  category: "Keywords",
  title: "How to Find and Add the Right Keywords to Your Resume",
  seoTitle: "Resume Keywords: How to Match Any Job Description",
  description:
    "A 5-step method to pull the right keywords from a job description and add them to your resume naturally — with examples for developer, analyst and fresher roles.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 7,
  keywords: ["resume keywords", "ATS keywords", "job description keywords", "keyword optimization resume", "tailor resume to job description"],
  body: [
    { type: "p", text: "Recruiters find candidates in an Applicant Tracking System by searching for skills and job titles. If your resume does not contain the words they search for, you can be a perfect fit and still never show up. Keyword optimisation is simply making sure the true, relevant skills you have are written the way the employer writes them." },

    { type: "h2", text: "Step 1: Collect two or three job descriptions" },
    { type: "p", text: "Do not tailor to only one posting unless it is your dream job. Take two or three descriptions for the same kind of role (for example “Data Analyst – fresher”) from Naukri, LinkedIn or company career pages. Skills that appear in all of them are the ones that matter most." },

    { type: "h2", text: "Step 2: Sort the keywords into four groups" },
    { type: "table", head: ["Group", "What to look for", "Example (Data Analyst)"], rows: [
      ["Hard skills & tools", "Languages, software, platforms", "SQL, Excel, Power BI, Python, pandas"],
      ["Job titles", "The title and close variants", "Data Analyst, Business Analyst, MIS Executive"],
      ["Domain words", "Industry and process terms", "reporting, KPIs, dashboards, data cleaning"],
      ["Qualifications", "Degrees, certifications, years", "B.Tech/B.Sc, Google Data Analytics certificate, 0–2 years"],
    ] },
    { type: "p", text: "Soft skills like “team player” and “good communication” appear in almost every post, and recruiters rarely search for them. Show them through your bullet points instead of listing them." },

    { type: "h2", text: "Step 3: Mark what you genuinely have" },
    { type: "p", text: "Go through your list and mark each keyword: have it and can prove it, have some exposure, or don’t have it. Only the first two belong on your resume — and exposure-level skills should be labelled honestly (for example “AWS — basic”). Anything on your resume is fair game in the interview." },

    { type: "h2", text: "Step 4: Put keywords where they carry weight" },
    { type: "ol", items: [
      "**Skills section** — the exact names, grouped (Languages, Tools, Databases…). This helps search matching.",
      "**Bullet points** — the same skills used in context, with results. This convinces the human reader.",
      "**Summary** — two or three of the most important skills plus the target job title.",
      "**Project and job titles** — when accurate, e.g. “Sales Dashboard in Power BI”.",
    ] },
    { type: "example", bad: "Skills: Data analysis, visualisation, databases", good: "Skills: **SQL** (joins, window functions), **Excel** (pivot tables, XLOOKUP), **Power BI**, **Python** (pandas, matplotlib)", note: "Specific tool names are what recruiters type into the search box." },

    { type: "h2", text: "Step 5: Match spelling and abbreviations" },
    { type: "p", text: "Write both forms for common abbreviations the first time: “Machine Learning (ML)”, “Search Engine Optimisation (SEO)”. Match the employer’s spelling of tools — “Node.js”, “PostgreSQL”, “Microsoft Excel”. For job titles, if yours was unusual (“Associate – Tech Ops”), you can add the common equivalent in brackets: “Associate – Tech Ops (IT Support)”." },

    { type: "h2", text: "How many keywords is too many?" },
    { type: "p", text: "Keyword stuffing — long lists of every technology you have heard of, or repeating a word ten times — backfires. Recruiters read the parsed text, and interviewers will ask about each item. A good rule: every skill in your skills section should also appear in at least one bullet that shows you using it." },
    { type: "tip", title: "Never hide keywords", text: "White or tiny text used to “trick” the ATS is extracted as normal text and shown to the recruiter. It is one of the quickest ways to get rejected." },

    { type: "h2", text: "Keyword examples by role" },
    { type: "table", head: ["Role", "Commonly searched keywords"], rows: [
      ["Java Developer (fresher)", "Java, OOP, Spring Boot, REST API, MySQL, Hibernate, Git, Data Structures"],
      ["Frontend Developer", "JavaScript, TypeScript, React, HTML5, CSS3, Tailwind, REST API, responsive design"],
      ["Data Analyst", "SQL, Excel, Power BI or Tableau, Python, data cleaning, dashboards, reporting"],
      ["Software Tester", "manual testing, test cases, Selenium, JIRA, SDLC, STLC, API testing, Postman"],
      ["Digital Marketing", "SEO, Google Ads, Meta Ads, Google Analytics, content marketing, campaign reporting"],
    ] },
    { type: "p", text: "These are starting points; always check the specific job description." },

    { type: "h2", text: "Check your keyword gap automatically" },
    { type: "p", text: "Paste a job description into HiResume along with your resume and it lists the important keywords you are missing and where they would fit — free." },
    { type: "cta", kind: "ats" },
    { type: "p", text: "Next: [the ATS-friendly resume format](/blog/ats-friendly-resume-format) and [150+ resume action verbs](/blog/resume-action-verbs)." },
  ],
  faq: [
    { q: "How do I find keywords for my resume?", a: "Take two or three job descriptions for the role you want, list the skills, tools, job titles and qualifications that repeat across them, and include the ones you genuinely have in your skills section and bullet points." },
    { q: "Should I copy the job description into my resume?", a: "No. Use the same skill names and titles where they are true for you, but write your own bullet points that show how you used those skills. Copied text reads badly to recruiters." },
  ],
};
