// @vitest-environment node
// Exports every template and reads it back the way an ATS does (text extraction in stream order),
// checking the text is complete, selectable and in reading order.
import { describe, it, expect } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const standardFontDataUrl = pathToFileURL(resolve("node_modules/pdfjs-dist/standard_fonts")).href + "/";
import { ATS_STYLES, ATS_TEMPLATE_IDS, SECTION_TITLES } from "./ats-pdf";
import { generateResumePdf as builderPdf } from "./resume-pdf-generator";
import { generateResumePdf as fixPdf, type TemplateType } from "./pdf-generator";
import { TEMPLATE_IDS, type ResumeContent } from "./resume-builder-types";

const cp = (...c: number[]) => String.fromCodePoint(...c);

/** Extract text in content-stream order, one entry per line (items with the same y are joined). */
async function extract(bytes: Uint8Array): Promise<{ pages: number; lines: string[]; text: string }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl, disableFontFace: true, verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    let lastY: number | null = null;
    for (const item of tc.items as { str: string; transform: number[] }[]) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) < 2) lines[lines.length - 1] += " " + item.str;
      else lines.push(item.str);
      lastY = y;
    }
  }
  return { pages: doc.numPages, lines, text: lines.join("\n") };
}

const resume: ResumeContent = {
  basicInfo: { fullName: "Priya Sharma", email: "priya@example.com", phone: "+91 98765 43210", linkedin: "linkedin.com/in/priya", github: "github.com/priya" },
  summary: `Backend engineer who saved ${cp(0x20b9)}2 lakh a year in cloud costs.`,
  skills: ["Java", "Spring Boot", "PostgreSQL", "Docker"],
  education: [{ degree: "B.Tech Computer Science", college: "Example Institute of Technology", year: "2023" }],
  projects: [{ name: "Campus Marketplace", techStack: "React, Node.js", description: "Built a buy/sell platform\nUsed by 180 students" }],
  experience: [{ company: "Acme Corp", role: "Software Engineer", duration: "Jul 2023 - Present", responsibilities: "Built REST APIs for orders\nCut p95 latency from 800 ms to 180 ms\nMentored 2 interns" }],
  certifications: [{ name: "AWS Cloud Practitioner", issuer: "Amazon", year: "2024" }],
};

describe("ATS templates export clean, ordered, selectable text", () => {
  it.each(ATS_TEMPLATE_IDS.map((id) => [id]))("%s", async (id) => {
    const { text, lines, pages } = await extract(await builderPdf(resume, id));
    expect(pages).toBe(1);
    // header first
    expect(lines[0]).toBe("Priya Sharma");
    expect(lines[1]).toContain("priya@example.com");
    // standard headings in the template's order
    const order = ATS_STYLES[id].order.map((s) => text.indexOf(SECTION_TITLES[s].toUpperCase()));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // bullets are separate lines, in order, under their job
    const [b1, b2, b3] = ["Built REST APIs for orders", "Cut p95 latency from 800 ms to 180 ms", "Mentored 2 interns"].map((s) => lines.findIndex((l) => l.includes(s)));
    expect(b1).toBeGreaterThan(lines.findIndex((l) => l.includes("Software Engineer, Acme Corp")));
    expect(b1 < b2 && b2 < b3).toBe(true);
    // date on the job line, rupee sign made printable, no text lost
    expect(lines.find((l) => l.includes("Software Engineer, Acme Corp"))).toContain("Jul 2023 - Present");
    expect(text).toContain("saved Rs.2 lakh");
    for (const needed of ["Spring Boot", "Example Institute of Technology", "Campus Marketplace", "Technologies: React, Node.js", "AWS Cloud Practitioner"]) {
      expect(text).toContain(needed);
    }
  });

  it("continues onto more pages instead of dropping content", async () => {
    const long: ResumeContent = {
      ...resume,
      experience: Array.from({ length: 14 }, (_, i) => ({
        company: `Company ${i + 1}`, role: "Engineer", duration: `${2010 + i}`,
        responsibilities: "Designed and built services for payments.\nImproved reliability of the order pipeline.\nLed code reviews for the team.",
      })),
    };
    for (const id of [...ATS_TEMPLATE_IDS, "minimal-ats" as const, "executive-clean" as const]) {
      const { pages, text } = await extract(await builderPdf(long, id));
      expect(pages, id).toBeGreaterThan(1);
      expect(text, id).toContain("Company 14"); // the last job is still there
      expect(text, id).toContain("AWS Cloud Practitioner");
    }
  });
});

describe("existing exporters no longer fail on real-world input", () => {
  const tricky: ResumeContent = {
    ...resume,
    basicInfo: { ...resume.basicInfo, fullName: `Ravi Kumar ${cp(0x0930, 0x093e, 0x0935, 0x093f)}` },
    summary: `Saved ${cp(0x20b9)}40,000 ${cp(0x2192)} rolled out to 3 teams ${cp(0x1f680)}`,
  };

  it.each(TEMPLATE_IDS.map((id) => [id]))("builder template %s exports rupee signs, Hindi text and line breaks", async (id) => {
    const { text } = await extract(await builderPdf(tricky, id));
    expect(text).toContain("Ravi Kumar");
    expect(text).toContain("Saved Rs.40,000 -> rolled out to 3 teams");
    expect(text).toContain("Mentored 2 interns");
  });

  it.each((["classic", "modern", "executive", "minimal", "impact"] as TemplateType[]).map((t) => [t]))("Resume Fix template %s exports the same input", async (t) => {
    const bytes = await fixPdf({
      name: tricky.basicInfo.fullName, email: "priya@example.com", phone: "+91 98765 43210", summary: tricky.summary,
      experience: [{ title: "Software Engineer", company: "Acme", duration: "2023", bullets: ["Built APIs\nfor orders", `Saved ${cp(0x20b9)}1 lakh`] }],
      education: [{ degree: "B.Tech", school: "ABC", year: "2023" }], skills: ["Java"],
    }, t);
    const { text } = await extract(bytes);
    expect(text).toContain("Rs.1 lakh");
  });
});
