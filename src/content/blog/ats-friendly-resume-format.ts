import type { Article } from "./types";

export const atsFriendlyResumeFormat: Article = {
  slug: "ats-friendly-resume-format",
  category: "Resume Tips",
  title: "ATS-Friendly Resume Format: Section-by-Section Template (2026)",
  seoTitle: "ATS-Friendly Resume Format 2026 (Template + Examples)",
  description:
    "The resume format that ATS software reads correctly: layout, fonts, section order and a copy-ready template for freshers and experienced candidates.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 7,
  keywords: ["ATS friendly resume format", "ATS resume template", "resume format 2026", "best resume format for ATS", "resume layout"],
  body: [
    { type: "p", text: "A good resume format does two jobs. It lets an Applicant Tracking System extract your details correctly, and it lets a recruiter find what they need in a few seconds. The good news: the format that works for software is also the one that works for people — simple, predictable and easy to scan." },

    { type: "h2", text: "The layout rules" },
    { type: "table", head: ["Do", "Avoid"], rows: [
      ["One column, top to bottom", "Two or three columns, sidebars"],
      ["Standard headings (Experience, Skills, Education)", "Creative headings (“My Story”, “Superpowers”)"],
      ["Text-based PDF or .docx", "Scanned PDF, image, Canva export flattened to an image"],
      ["Calibri, Arial, Inter, Garamond at 10–12 pt", "Decorative fonts, text under 9 pt"],
      ["Plain bullet points (•)", "Icons, skill bars, star ratings, charts"],
      ["Contact details in the main body", "Contact details only in header/footer"],
      ["Margins of about 0.5–1 inch", "Text squeezed edge to edge to fit one page"],
    ] },
    { type: "tip", title: "Photos", text: "Indian employers do not need a photo on your resume, and many international ones actively prefer none. A photo also adds nothing an ATS can read. Leave it off unless a job post specifically asks for one." },

    { type: "h2", text: "Which format: chronological, functional or hybrid?" },
    { type: "ul", items: [
      "**Reverse-chronological** (most recent first) — the default. Best for almost everyone, and what ATS parsers expect.",
      "**Hybrid** — a strong skills section near the top, followed by chronological experience. Good for freshers and career switchers.",
      "**Functional** (skills only, no timeline) — avoid. Parsers struggle to connect skills to roles, and recruiters often read it as hiding gaps.",
    ] },

    { type: "h2", text: "Section order" },
    { type: "p", text: "For experienced candidates:" },
    { type: "ol", items: ["Name and contact details", "Professional summary (2–3 lines)", "Skills", "Work experience", "Projects (optional)", "Education", "Certifications, awards"] },
    { type: "p", text: "For freshers and students, move proof of ability higher:" },
    { type: "ol", items: ["Name and contact details", "Summary or career objective (2 lines, specific)", "Education (degree, college, CGPA/percentage, year)", "Skills", "Projects", "Internships / training", "Certifications, achievements, positions of responsibility"] },

    { type: "h2", text: "Section by section" },
    { type: "h3", text: "Contact details" },
    { type: "p", text: "Full name as your first line, then on one or two lines: phone with country code (+91), a professional email, city, LinkedIn URL and GitHub or portfolio if relevant. You do not need your full address, date of birth, father’s name or marital status." },
    { type: "h3", text: "Summary" },
    { type: "example", bad: "Hardworking and passionate individual seeking a challenging role in a reputed organisation.", good: "Computer Science graduate (2025, CGPA 8.2) with hands-on projects in **Java**, **Spring Boot** and **MySQL**, including a REST API used by 300+ students for hostel complaints. Looking for a backend developer role.", note: "Specific skills, one proof point, one clear target." },
    { type: "h3", text: "Skills" },
    { type: "p", text: "Group them so they are easy to scan, and use the names job posts use:" },
    { type: "ul", items: [
      "**Languages:** Java, Python, SQL, JavaScript",
      "**Frameworks & tools:** Spring Boot, React, Git, Docker, Postman",
      "**Data:** MySQL, PostgreSQL, Excel (pivot tables, VLOOKUP), Power BI",
      "**Cloud:** AWS (EC2, S3) — basic",
    ] },
    { type: "p", text: "Only list what you can answer interview questions about. A skill on your resume is an invitation for the interviewer to ask about it." },
    { type: "h3", text: "Experience and projects" },
    { type: "p", text: "Each entry: role or project title, organisation, location (optional) and dates on one line; then 2–5 bullets. Start each bullet with an action verb, say what you did with which tools, and end with a result. See [how to quantify achievements](/blog/quantify-resume-achievements) for more examples." },
    { type: "example", bad: "Responsible for testing the application.", good: "Wrote 120+ **Selenium** test cases for the checkout flow, catching 14 defects before release and cutting regression time from 2 days to 4 hours." },
    { type: "h3", text: "Education" },
    { type: "p", text: "Degree and branch, college, university, year of passing and CGPA or percentage. For freshers, add Class XII and X with year and percentage, because many campus and off-campus drives filter on these." },

    { type: "h2", text: "Length" },
    { type: "p", text: "Freshers and candidates with under about 5 years of experience: one page. More experience: two pages is fine. Never shrink the font to force a fit — cut older or weaker points instead." },

    { type: "h2", text: "File name and file type" },
    { type: "p", text: "Save as a text-based PDF unless the application asks for Word. Name it “Firstname-Lastname-Resume.pdf”. Test it by copying all text from the PDF into Notepad: if it comes out in the right order, parsers will read it too." },

    { type: "h2", text: "Build it or check it" },
    { type: "p", text: "You can build a resume in this exact format with the HiResume builder, or upload your current resume to see how an ATS parses it and what to fix." },
    { type: "cta", kind: "builder" },
    { type: "cta", kind: "ats" },
  ],
  faq: [
    { q: "Which resume format is best for ATS?", a: "A one-column, reverse-chronological resume with standard section headings (Summary, Skills, Experience, Projects, Education), a common font and no tables, images or text boxes, saved as a text-based PDF." },
    { q: "Are resume templates from Canva ATS-friendly?", a: "Many are not, because they use columns, icons and text boxes, and some exports flatten text into images. If you use one, pick a single-column template and test the PDF by copying its text into Notepad." },
    { q: "Should a fresher resume be one page?", a: "Yes. One focused page with education, skills, projects and internships is easier for both ATS and recruiters than two pages of filler." },
  ],
};
