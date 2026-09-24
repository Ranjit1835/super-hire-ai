import type { Article } from "./types";

export const fresherResumeGuide: Article = {
  slug: "fresher-resume-guide",
  category: "For Students",
  title: "Resume for Freshers: Format, Examples and What to Write With No Experience",
  seoTitle: "Resume Format for Freshers (2026) — With Examples",
  description:
    "How to write a fresher resume for campus placements and off-campus jobs: the right format, what to put in each section, project examples and a checklist.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 8,
  keywords: ["resume for freshers", "fresher resume format", "resume format for freshers", "campus placement resume", "resume with no experience", "B.Tech fresher resume"],
  body: [
    { type: "p", text: "As a fresher you are not competing on experience — nobody in your batch has much. You are competing on how clearly you show **eligibility, skills and proof that you can build or do things**. This guide walks through a fresher resume section by section, with examples for engineering, science and commerce graduates." },

    { type: "h2", text: "The fresher resume format" },
    { type: "ol", items: [
      "**Header** — name, phone (+91), professional email, city, LinkedIn, GitHub/portfolio.",
      "**Summary** — two lines, specific.",
      "**Education** — degree first, then Class XII and X.",
      "**Skills** — grouped by type.",
      "**Projects** — your strongest section. 2–3 projects.",
      "**Internships / training** — if any.",
      "**Certifications, achievements, positions of responsibility.**",
    ] },
    { type: "p", text: "Keep it to **one page**, one column, in a standard font. Why this matters for software screening is explained in [what is an ATS resume](/blog/what-is-ats-resume)." },

    { type: "h2", text: "Summary: specific beats “hardworking”" },
    { type: "example", bad: "Hardworking and dedicated fresher looking for an opportunity to grow in a reputed company.", good: "B.Tech (ECE) 2025 graduate, CGPA 7.9, skilled in **Python**, **SQL** and **Power BI**. Built a student-attendance dashboard used by 3 departments. Seeking a Data Analyst role." },

    { type: "h2", text: "Education: make eligibility easy to check" },
    { type: "p", text: "Many campus and off-campus drives shortlist on degree, branch, year of passing and marks. Put them where they can’t be missed:" },
    { type: "table", head: ["Qualification", "Institution", "Year", "Score"], rows: [
      ["B.Tech, Computer Science", "ABC Institute of Technology, JNTU", "2025", "CGPA 8.1"],
      ["Class XII (MPC)", "XYZ Junior College, TS Board", "2021", "92%"],
      ["Class X", "St. Mary’s High School, CBSE", "2019", "9.4 CGPA"],
    ] },
    { type: "p", text: "If you have backlogs that are cleared, you don’t need to mention them on the resume, but answer honestly if asked. If a drive requires no active backlogs and you have one, check eligibility before applying." },

    { type: "h2", text: "Skills: only what you can defend" },
    { type: "p", text: "Group skills (Languages, Web, Databases, Tools, Core subjects) and include core CS subjects if you are applying for IT roles — interviewers for fresher roles ask about **OOP, DBMS, Operating Systems, Computer Networks and Data Structures** constantly." },
    { type: "tip", title: "The interview rule", text: "Every skill on your resume can become an interview question. If you list C++, expect questions on pointers and OOP. If you can’t answer basics, remove it or mark it “basic”." },

    { type: "h2", text: "Projects: your experience section" },
    { type: "p", text: "For each project write a title, the tech stack, and 2–3 bullets covering **what it does, what you built, and a result** (users, data size, speed, marks, award)." },
    { type: "example", bad: "Online Shopping Website — Made an e-commerce website using HTML, CSS and PHP.", good: "**Campus Marketplace** (React, Node.js, MongoDB) — Built a buy/sell platform for used books with login, listings and chat; 180 students listed 400+ books in the first month. Designed the REST API and wrote the listing search with MongoDB text indexes." },
    { type: "p", text: "No big project? A well-documented mini project on GitHub, a Kaggle notebook, a hackathon entry or an automation you built for a college club all count. Quality and clarity beat quantity." },

    { type: "h2", text: "Internships, training and certifications" },
    { type: "p", text: "Treat an internship like a job: role, company, dates and results. Industrial training and virtual internships count too if you did real work — describe what you built or analysed, not just the course name. For certifications, prefer ones relevant to the role (for example cloud, data analytics or a language certification) and list the issuer and year." },

    { type: "h2", text: "Achievements and positions of responsibility" },
    { type: "ul", items: [
      "Hackathon or coding contest ranks (CodeChef, LeetCode contests, college fests).",
      "Club roles with results — “Organised a 2-day tech fest for 1,200 participants as event lead.”",
      "NSS/NCC, sports or cultural achievements — one line each; they show teamwork and commitment.",
    ] },

    { type: "h2", text: "What to leave out" },
    { type: "ul", items: [
      "Date of birth, father’s name, religion, marital status, full address, photo and signature.",
      "“Declaration: I hereby declare that the above information is true…” — not needed.",
      "Hobbies like “listening to music” unless they’re relevant or genuinely distinctive.",
      "Skill bars or percentages (“Java 80%”) — meaningless to readers and invisible to ATS.",
    ] },

    { type: "h2", text: "Fresher resume checklist" },
    { type: "ul", items: [
      "One page, one column, text-based PDF named “Firstname-Lastname-Resume.pdf”.",
      "Degree, branch, year of passing and CGPA/percentage visible in the top half.",
      "Skills match the role you are applying for; each key skill backed by a project.",
      "Every project bullet has a verb, a technology and a result.",
      "Email and phone checked; LinkedIn and GitHub links work.",
    ] },

    { type: "h2", text: "Check it and practise the interview" },
    { type: "p", text: "Upload your resume to HiResume for a free ATS score and specific fixes. Then practise explaining your projects out loud — that is exactly what the technical and HR rounds will ask." },
    { type: "cta", kind: "ats" },
    { type: "cta", kind: "interview" },
  ],
  faq: [
    { q: "What is the best resume format for freshers?", a: "A one-page, one-column resume in this order: contact details, a two-line summary, education (with CGPA/percentage and year), skills, projects, internships, then certifications and achievements." },
    { q: "How can I write a resume with no experience?", a: "Use projects, internships, training, hackathons and positions of responsibility as your experience. For each, describe what you built or did, the tools you used, and a measurable result." },
    { q: "Should I mention my CGPA on my resume?", a: "Yes. Many placement drives filter on CGPA or percentage, so include it for your degree along with Class XII and X marks." },
  ],
};
