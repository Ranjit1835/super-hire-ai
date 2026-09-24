import type { Article } from "./types";

export const whatIsAtsResume: Article = {
  slug: "what-is-ats-resume",
  category: "ATS Basics",
  title: "What Is an ATS Resume? A Plain-English Guide for 2026",
  seoTitle: "What Is an ATS Resume? Meaning, How ATS Works & Tips",
  description:
    "What an ATS is, how it reads your resume, what really gets resumes filtered out, and how to write an ATS-friendly resume that recruiters also want to read.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 8,
  keywords: ["what is ATS resume", "ATS meaning", "applicant tracking system", "ATS friendly resume", "how ATS works"],
  body: [
    { type: "p", text: "If you have applied to a company through its careers page, Naukri, LinkedIn or a campus drive portal, your resume almost certainly went into an **Applicant Tracking System (ATS)** before any person looked at it. An ATS resume is simply a resume written and formatted so that this software can read it correctly — and so that the recruiter searching inside it can find you." },
    { type: "p", text: "This guide explains what an ATS actually does, what it does not do (there are a lot of myths), and the practical changes that make your resume both machine-readable and convincing to a human." },

    { type: "h2", text: "What is an Applicant Tracking System?" },
    { type: "p", text: "An ATS is the software companies use to collect and manage job applications. Popular ones include Workday, SAP SuccessFactors, Oracle Taleo, Greenhouse, Lever and iCIMS; many Indian companies and staffing firms use their own portals or tools like Zoho Recruit and Darwinbox. Whatever the brand, they do roughly the same four jobs:" },
    { type: "ol", items: [
      "**Collect** applications from the careers page, job boards and referrals in one place.",
      "**Parse** each resume — turn your PDF or Word file into structured fields such as name, phone, education, skills and work history.",
      "**Let recruiters search and filter** — for example “Java AND Spring Boot, 0–2 years, Bengaluru”, or “B.Tech 2025 with 60%+”.",
      "**Track** every candidate through stages like screening, test, interview and offer.",
    ] },
    { type: "tip", title: "The important part", text: "Most rejections are not a robot deciding you are bad. They happen because the resume was parsed badly, so key details are missing, or because it does not contain the words the recruiter searched for. Both are fixable." },

    { type: "h2", text: "How an ATS reads your resume" },
    { type: "p", text: "Parsing is where most resumes lose information. The software reads your file as text, from top to bottom, and tries to guess which text belongs to which field. Things that confuse it:" },
    { type: "ul", items: [
      "**Two-column layouts and tables** — text can be read across columns, mixing your skills into your job titles.",
      "**Text inside images, icons or text boxes** — often skipped entirely. A skills section drawn as progress bars is invisible.",
      "**Contact details in the header or footer** — some parsers ignore these areas, so recruiters cannot find your phone number.",
      "**Unusual section names** — “My Journey” instead of “Experience” or “Toolbox” instead of “Skills”.",
      "**Scanned PDFs** — a photo of a resume has no text for the ATS to read at all.",
    ] },
    { type: "p", text: "A quick self-test: open your PDF, press Ctrl+A, copy, and paste into Notepad. If the pasted text is jumbled, out of order or missing sections, an ATS will struggle too." },

    { type: "h2", text: "How keyword matching really works" },
    { type: "p", text: "Recruiters search the ATS the way you search Google. If the job needs “SQL” and “Power BI” and your resume says “databases” and “dashboards”, you may not appear in their results even if you have the skills. Some systems also show a match percentage between your resume and the job description." },
    { type: "p", text: "That is why tailoring matters. You do not need a different resume for every job, but you should make sure the **exact skill names** from the job description appear where they are true for you — in your skills section and in the bullet points that prove them." },
    { type: "example", bad: "Worked on data analysis for college project.", good: "Analysed 12,000 sales records using **SQL** and **Excel pivot tables**, and built a **Power BI** dashboard used in the final project review.", note: "Same work, but the second version contains the searchable skills and shows scale." },

    { type: "h2", text: "Common ATS myths" },
    { type: "table", head: ["Myth", "Reality"], rows: [
      ["“75% of resumes are rejected by ATS automatically.”", "There is no reliable source for this number. Many systems do not auto-reject at all; recruiters filter and search. Knockout questions (like location or notice period) are the main automatic filters."],
      ["“You must use a plain Word document.”", "A clean, text-based PDF is read well by modern systems. Avoid scanned or image-based PDFs."],
      ["“Hiding keywords in white text works.”", "Parsed text is shown to recruiters as plain text, so hidden keywords become visible — and look dishonest."],
      ["“A higher ATS score guarantees interviews.”", "A score only measures readability and keyword match. A human still decides, based on evidence of skills and results."],
    ] },

    { type: "h2", text: "What an ATS-friendly resume looks like" },
    { type: "ul", items: [
      "**One column**, with clear section headings: Summary, Skills, Experience, Projects, Education, Certifications.",
      "**Standard fonts** such as Calibri, Arial or Inter at 10–12 pt; no text in images.",
      "**Contact details in the body** at the top: name, phone, email, city, LinkedIn and GitHub or portfolio.",
      "**Dates in a consistent format** — for example “Jun 2024 – Aug 2024”.",
      "**Skills written the way job posts write them** — “JavaScript”, not “JS” only; “Microsoft Excel”, not just “spreadsheets”.",
      "**Bullet points that start with an action verb and include a result** — numbers wherever you honestly can.",
      "**A text-based PDF** named sensibly, like “Priya-Sharma-Resume.pdf”.",
    ] },
    { type: "p", text: "Read our [ATS-friendly resume format guide](/blog/ats-friendly-resume-format) for a section-by-section template, and [how to optimise resume keywords](/blog/resume-keywords-optimization) for a step-by-step tailoring method." },

    { type: "h2", text: "Does this matter for freshers and campus placements?" },
    { type: "p", text: "Yes. Campus drives and off-campus hiring for large IT services companies receive very large numbers of applications, and shortlisting relies heavily on eligibility filters (degree, branch, percentage, graduation year) and on searching resumes for skills. A fresher resume that clearly lists degree, CGPA or percentage, year of passing, skills and projects in a simple layout is far easier to shortlist. Our [resume guide for freshers](/blog/fresher-resume-guide) covers this in detail." },

    { type: "h2", text: "Check your resume in 10 seconds" },
    { type: "p", text: "The fastest way to see how software reads your resume is to test it. HiResume parses your resume like an ATS, shows what it extracted, and scores keywords, formatting and impact — free and without signing up." },
    { type: "cta", kind: "ats" },
  ],
  faq: [
    { q: "What does ATS stand for in a resume?", a: "ATS stands for Applicant Tracking System — software that companies use to collect, read (parse), search and manage job applications. An ATS resume is one formatted so this software can read it correctly." },
    { q: "Is a PDF resume ATS-friendly?", a: "A text-based PDF created from Word, Google Docs or a resume builder is read well by modern ATS. A scanned PDF or a resume exported as an image is not, because it contains no readable text." },
    { q: "What is a good ATS score?", a: "Scores differ between tools, but aim for a resume that parses cleanly (all sections and contact details extracted) and contains most of the must-have skills from the job description. Above roughly 75 on HiResume usually means formatting is not holding you back." },
  ],
};
