import { ResumeContent, TemplateId, TEMPLATE_IDS, TEMPLATE_NAMES } from "@/lib/resume-builder-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  content: ResumeContent;
  templateId: TemplateId;
  onTemplateChange: (id: TemplateId) => void;
  isPaid: boolean;
}

export function ResumeTemplatePreview({ content, templateId, onTemplateChange, isPaid }: Props) {
  const currentIndex = TEMPLATE_IDS.indexOf(templateId);

  const prev = () => {
    const i = (currentIndex - 1 + TEMPLATE_IDS.length) % TEMPLATE_IDS.length;
    onTemplateChange(TEMPLATE_IDS[i]);
  };
  const next = () => {
    const i = (currentIndex + 1) % TEMPLATE_IDS.length;
    onTemplateChange(TEMPLATE_IDS[i]);
  };

  return (
    <div>
      {/* Template selector */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="icon" onClick={prev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-medium text-sm">{TEMPLATE_NAMES[templateId]}</p>
          <p className="text-xs text-muted-foreground">{currentIndex + 1} of {TEMPLATE_IDS.length}</p>
        </div>
        <Button variant="outline" size="icon" onClick={next}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Template badges */}
      <div className="flex flex-wrap gap-1.5 mb-4 justify-center">
        {TEMPLATE_IDS.map((id) => (
          <Badge
            key={id}
            variant={id === templateId ? "default" : "outline"}
            className="cursor-pointer text-xs"
            onClick={() => onTemplateChange(id)}
          >
            {TEMPLATE_NAMES[id]}
          </Badge>
        ))}
      </div>

      {/* Preview */}
      <div className="relative border border-border rounded-lg overflow-hidden bg-white">
        {!isPaid && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="absolute inset-0 backdrop-blur-[6px] bg-white/30" style={{ top: "30%" }} />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white/90 to-transparent h-2/3" />
            <p className="absolute bottom-1/3 text-sm font-semibold text-muted-foreground/80 rotate-[-15deg] select-none">
              HireResume – Locked Preview
            </p>
          </div>
        )}
        <div className="p-6 text-[11px] leading-relaxed text-gray-800 min-h-[600px]" style={{ fontFamily: "serif" }}>
          <TemplateRenderer content={content} templateId={templateId} />
        </div>
      </div>
    </div>
  );
}

function TemplateRenderer({ content, templateId }: { content: ResumeContent; templateId: TemplateId }) {
  switch (templateId) {
    case "minimal-ats":
      return <MinimalATS content={content} />;
    case "modern-professional":
      return <ModernProfessional content={content} />;
    case "clean-fresher":
      return <CleanFresher content={content} />;
    case "tech-bold":
      return <TechBold content={content} />;
    case "compact-onepage":
      return <CompactOnePage content={content} />;
    case "executive-clean":
      return <ExecutiveClean content={content} />;
    case "creative-minimal":
      return <CreativeMinimal content={content} />;
    case "two-column-pro":
      return <TwoColumnPro content={content} />;
    case "data-tech-focused":
      return <DataTechFocused content={content} />;
    case "ultra-compact":
      return <UltraCompact content={content} />;
    default:
      return <MinimalATS content={content} />;
  }
}

// --- Template Components ---

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${className}`}>{children}</h3>;
}

function MinimalATS({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="text-center mb-4">
        <h1 className="text-lg font-bold text-gray-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-gray-600">
          {[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" • ")}
        </p>
      </div>
      {content.summary && <><SectionTitle>Summary</SectionTitle><p className="mb-3">{content.summary}</p></>}
      {content.skills.length > 0 && <><SectionTitle>Skills</SectionTitle><p className="mb-3">{content.skills.join(", ")}</p></>}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle>Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{e.degree}</span> — {e.college} {e.year && `(${e.year})`}</div>
        ))}</>
      )}
      {content.experience.filter(e => e.company).length > 0 && (
        <><SectionTitle>Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{e.role}</span> at {e.company} {e.duration && `| ${e.duration}`}<p className="mt-0.5">{e.responsibilities}</p></div>
        ))}</>
      )}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle>Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{p.name}</span> {p.techStack && <span className="text-gray-500">({p.techStack})</span>}<p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle>Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1"><span className="font-semibold">{c.name}</span> — {c.issuer} {c.year && `(${c.year})`}</div>
        ))}</>
      )}
    </div>
  );
}

function ModernProfessional({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="border-b-2 border-blue-600 pb-3 mb-4">
        <h1 className="text-xl font-bold text-blue-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-gray-600 mt-0.5">
          {[basicInfo.email, basicInfo.phone].filter(Boolean).join(" | ")}
        </p>
        <p className="text-[10px] text-blue-600">
          {[basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" | ")}
        </p>
      </div>
      {content.summary && <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Professional Summary</SectionTitle><p className="mb-3 italic">{content.summary}</p></>}
      {content.skills.length > 0 && <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Core Competencies</SectionTitle><div className="flex flex-wrap gap-1 mb-3">{content.skills.map((s, i) => <span key={i} className="bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded text-[10px]">{s}</span>)}</div></>}
      {content.experience.filter(e => e.company).length > 0 && (
        <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Professional Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-3"><div className="flex justify-between"><span className="font-bold">{e.role}</span><span className="text-gray-500">{e.duration}</span></div><p className="text-gray-600">{e.company}</p><p className="mt-1">{e.responsibilities}</p></div>
        ))}</>
      )}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Key Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-bold">{p.name}</span> <span className="text-gray-500 text-[10px]">{p.techStack}</span><p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-bold">{e.degree}</span> — {e.college} {e.year && `(${e.year})`}</div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle className="text-blue-800 border-b border-blue-200 pb-0.5">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1">{c.name} — {c.issuer} {c.year && `(${c.year})`}</div>
        ))}</>
      )}
    </div>
  );
}

function CleanFresher({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="bg-emerald-50 -m-6 mb-4 p-6 pb-4">
        <h1 className="text-xl font-bold text-emerald-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-emerald-700 mt-0.5">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" • ")}</p>
      </div>
      {content.summary && <><SectionTitle className="text-emerald-800">About Me</SectionTitle><p className="mb-3">{content.summary}</p></>}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle className="text-emerald-800">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{e.degree}</span><br />{e.college} {e.year && `• ${e.year}`}</div>
        ))}</>
      )}
      {content.skills.length > 0 && <><SectionTitle className="text-emerald-800">Skills</SectionTitle><p className="mb-3">{content.skills.join(" • ")}</p></>}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle className="text-emerald-800">Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{p.name}</span> <span className="text-gray-500">| {p.techStack}</span><p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle className="text-emerald-800">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1">{c.name} — {c.issuer} {c.year && `(${c.year})`}</div>
        ))}</>
      )}
    </div>
  );
}

function TechBold({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div style={{ fontFamily: "monospace" }}>
      <div className="mb-4">
        <h1 className="text-xl font-black text-gray-900 uppercase">{basicInfo.fullName || "YOUR NAME"}</h1>
        <p className="text-[10px] text-gray-500">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" | ")}</p>
      </div>
      {content.summary && <><div className="border-l-4 border-orange-500 pl-2 mb-3"><SectionTitle>// SUMMARY</SectionTitle><p>{content.summary}</p></div></>}
      {content.skills.length > 0 && <><div className="border-l-4 border-orange-500 pl-2 mb-3"><SectionTitle>// TECH STACK</SectionTitle><div className="flex flex-wrap gap-1">{content.skills.map((s, i) => <span key={i} className="bg-gray-900 text-white px-1.5 py-0.5 rounded text-[9px]">{s}</span>)}</div></div></>}
      {content.experience.filter(e => e.company).length > 0 && (
        <div className="border-l-4 border-orange-500 pl-2 mb-3"><SectionTitle>// EXPERIENCE</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-2"><span className="font-bold">{e.role}</span> @ {e.company} <span className="text-gray-400">[{e.duration}]</span><p className="mt-0.5">{e.responsibilities}</p></div>
        ))}</div>
      )}
      {content.projects.filter(p => p.name).length > 0 && (
        <div className="border-l-4 border-orange-500 pl-2 mb-3"><SectionTitle>// PROJECTS</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-bold">{p.name}</span> <span className="text-orange-600">[{p.techStack}]</span><p className="mt-0.5">{p.description}</p></div>
        ))}</div>
      )}
      {content.education.filter(e => e.degree).length > 0 && (
        <div className="border-l-4 border-orange-500 pl-2 mb-3"><SectionTitle>// EDUCATION</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-bold">{e.degree}</span> — {e.college} {e.year && `[${e.year}]`}</div>
        ))}</div>
      )}
    </div>
  );
}

function CompactOnePage({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div className="text-[10px] leading-tight">
      <div className="text-center mb-2 border-b border-gray-300 pb-2">
        <h1 className="text-base font-bold">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-gray-600">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" • ")}</p>
      </div>
      {content.summary && <><p className="font-bold uppercase text-[9px] text-gray-500 mb-0.5">Summary</p><p className="mb-2">{content.summary}</p></>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          {content.skills.length > 0 && <><p className="font-bold uppercase text-[9px] text-gray-500 mb-0.5">Skills</p><p className="mb-2">{content.skills.join(", ")}</p></>}
          {content.education.filter(e => e.degree).length > 0 && (
            <><p className="font-bold uppercase text-[9px] text-gray-500 mb-0.5">Education</p>{content.education.filter(e => e.degree).map((e, i) => (
              <div key={i} className="mb-1"><span className="font-semibold">{e.degree}</span><br />{e.college} {e.year}</div>
            ))}</>
          )}
        </div>
        <div>
          {content.projects.filter(p => p.name).length > 0 && (
            <><p className="font-bold uppercase text-[9px] text-gray-500 mb-0.5">Projects</p>{content.projects.filter(p => p.name).map((p, i) => (
              <div key={i} className="mb-1"><span className="font-semibold">{p.name}</span> <span className="text-gray-500">({p.techStack})</span><br />{p.description}</div>
            ))}</>
          )}
        </div>
      </div>
      {content.experience.filter(e => e.company).length > 0 && (
        <><p className="font-bold uppercase text-[9px] text-gray-500 mb-0.5 mt-2">Experience</p>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-semibold">{e.role}</span> at {e.company} ({e.duration})<br />{e.responsibilities}</div>
        ))}</>
      )}
    </div>
  );
}

// --- NEW TEMPLATES ---

function ExecutiveClean({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="border-b-[3px] border-gray-900 pb-3 mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-gray-500 mt-1 tracking-wide uppercase">
          {[basicInfo.email, basicInfo.phone].filter(Boolean).join("  ·  ")}
        </p>
        <p className="text-[10px] text-gray-400">{[basicInfo.linkedin, basicInfo.github].filter(Boolean).join("  ·  ")}</p>
      </div>
      {content.summary && <><SectionTitle className="border-b border-gray-200 pb-0.5">Executive Summary</SectionTitle><p className="mb-4 italic text-gray-700">{content.summary}</p></>}
      {content.experience.filter(e => e.company).length > 0 && (
        <><SectionTitle className="border-b border-gray-200 pb-0.5">Professional Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-3"><div className="flex justify-between items-baseline"><span className="font-bold text-gray-900">{e.role}</span><span className="text-[9px] text-gray-400">{e.duration}</span></div><p className="text-gray-600 text-[10px]">{e.company}</p><p className="mt-1">{e.responsibilities}</p></div>
        ))}</>
      )}
      {content.skills.length > 0 && <><SectionTitle className="border-b border-gray-200 pb-0.5">Core Competencies</SectionTitle><p className="mb-3">{content.skills.join("  ·  ")}</p></>}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle className="border-b border-gray-200 pb-0.5">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-semibold">{e.degree}</span> — {e.college} {e.year && `(${e.year})`}</div>
        ))}</>
      )}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle className="border-b border-gray-200 pb-0.5">Key Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{p.name}</span> {p.techStack && <span className="text-gray-400">({p.techStack})</span>}<p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle className="border-b border-gray-200 pb-0.5">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1">{c.name} — {c.issuer} {c.year && `(${c.year})`}</div>
        ))}</>
      )}
    </div>
  );
}

function CreativeMinimal({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-light text-gray-900 tracking-wide">{basicInfo.fullName || "Your Name"}</h1>
        <div className="h-0.5 w-12 bg-violet-500 mt-1 mb-2" />
        <p className="text-[10px] text-gray-500">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join("  |  ")}</p>
      </div>
      {content.summary && <><SectionTitle className="text-violet-700">Profile</SectionTitle><p className="mb-4 text-gray-700">{content.summary}</p></>}
      {content.skills.length > 0 && <><SectionTitle className="text-violet-700">Skills</SectionTitle><div className="flex flex-wrap gap-1.5 mb-4">{content.skills.map((s, i) => <span key={i} className="border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full text-[9px]">{s}</span>)}</div></>}
      {content.experience.filter(e => e.company).length > 0 && (
        <><SectionTitle className="text-violet-700">Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-3 pl-3 border-l-2 border-violet-200"><span className="font-semibold">{e.role}</span> <span className="text-gray-400">@ {e.company}</span> <span className="text-[9px] text-gray-400 block">{e.duration}</span><p className="mt-1">{e.responsibilities}</p></div>
        ))}</>
      )}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle className="text-violet-700">Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2 pl-3 border-l-2 border-violet-200"><span className="font-semibold">{p.name}</span> {p.techStack && <span className="text-gray-400 text-[10px]">· {p.techStack}</span>}<p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle className="text-violet-700">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-semibold">{e.degree}</span> — {e.college} {e.year && `(${e.year})`}</div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle className="text-violet-700">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1">{c.name} — {c.issuer} {c.year && `(${c.year})`}</div>
        ))}</>
      )}
    </div>
  );
}

function TwoColumnPro({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div>
      <div className="text-center mb-4 pb-3 border-b-2 border-teal-600">
        <h1 className="text-xl font-bold text-teal-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-gray-500 mt-0.5">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join("  •  ")}</p>
      </div>
      {content.summary && <p className="mb-4 text-center italic text-gray-600 text-[10px]">{content.summary}</p>}
      <div className="grid grid-cols-[1fr_2fr] gap-4">
        <div className="space-y-3">
          {content.skills.length > 0 && <><SectionTitle className="text-teal-800">Skills</SectionTitle><div className="space-y-0.5">{content.skills.map((s, i) => <p key={i} className="text-[10px]">• {s}</p>)}</div></>}
          {content.education.filter(e => e.degree).length > 0 && (
            <><SectionTitle className="text-teal-800">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
              <div key={i} className="mb-2"><p className="font-semibold text-[10px]">{e.degree}</p><p className="text-[9px] text-gray-500">{e.college}</p>{e.year && <p className="text-[9px] text-gray-400">{e.year}</p>}</div>
            ))}</>
          )}
          {content.certifications.filter(c => c.name).length > 0 && (
            <><SectionTitle className="text-teal-800">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
              <div key={i} className="mb-1 text-[10px]"><p className="font-semibold">{c.name}</p><p className="text-[9px] text-gray-400">{c.issuer} {c.year}</p></div>
            ))}</>
          )}
        </div>
        <div className="space-y-3 border-l border-teal-100 pl-4">
          {content.experience.filter(e => e.company).length > 0 && (
            <><SectionTitle className="text-teal-800">Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
              <div key={i} className="mb-3"><div className="flex justify-between"><span className="font-bold">{e.role}</span><span className="text-[9px] text-gray-400">{e.duration}</span></div><p className="text-gray-500 text-[10px]">{e.company}</p><p className="mt-1">{e.responsibilities}</p></div>
            ))}</>
          )}
          {content.projects.filter(p => p.name).length > 0 && (
            <><SectionTitle className="text-teal-800">Projects</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
              <div key={i} className="mb-2"><span className="font-bold">{p.name}</span> {p.techStack && <span className="text-gray-400 text-[10px]">({p.techStack})</span>}<p className="mt-0.5">{p.description}</p></div>
            ))}</>
          )}
        </div>
      </div>
    </div>
  );
}

function DataTechFocused({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div style={{ fontFamily: "'Courier New', monospace" }}>
      <div className="mb-4 pb-2 border-b border-cyan-500">
        <h1 className="text-lg font-black text-cyan-900">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-[10px] text-gray-500">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" | ")}</p>
      </div>
      {content.skills.length > 0 && (
        <div className="mb-4 p-2 bg-cyan-50 rounded">
          <SectionTitle className="text-cyan-800">Technical Skills</SectionTitle>
          <div className="flex flex-wrap gap-1">{content.skills.map((s, i) => <span key={i} className="bg-cyan-800 text-white px-1.5 py-0.5 rounded text-[9px] font-mono">{s}</span>)}</div>
        </div>
      )}
      {content.summary && <><SectionTitle className="text-cyan-800">Summary</SectionTitle><p className="mb-3">{content.summary}</p></>}
      {content.projects.filter(p => p.name).length > 0 && (
        <><SectionTitle className="text-cyan-800">Projects & Contributions</SectionTitle>{content.projects.filter(p => p.name).map((p, i) => (
          <div key={i} className="mb-2"><span className="font-bold">{p.name}</span> <span className="text-cyan-600 text-[9px]">[{p.techStack}]</span><p className="mt-0.5">{p.description}</p></div>
        ))}</>
      )}
      {content.experience.filter(e => e.company).length > 0 && (
        <><SectionTitle className="text-cyan-800">Experience</SectionTitle>{content.experience.filter(e => e.company).map((e, i) => (
          <div key={i} className="mb-2"><span className="font-bold">{e.role}</span> @ {e.company} <span className="text-gray-400">[{e.duration}]</span><p className="mt-0.5">{e.responsibilities}</p></div>
        ))}</>
      )}
      {content.education.filter(e => e.degree).length > 0 && (
        <><SectionTitle className="text-cyan-800">Education</SectionTitle>{content.education.filter(e => e.degree).map((e, i) => (
          <div key={i} className="mb-1"><span className="font-bold">{e.degree}</span> — {e.college} {e.year && `[${e.year}]`}</div>
        ))}</>
      )}
      {content.certifications.filter(c => c.name).length > 0 && (
        <><SectionTitle className="text-cyan-800">Certifications</SectionTitle>{content.certifications.filter(c => c.name).map((c, i) => (
          <div key={i} className="mb-1">{c.name} — {c.issuer} {c.year && `[${c.year}]`}</div>
        ))}</>
      )}
    </div>
  );
}

function UltraCompact({ content }: { content: ResumeContent }) {
  const { basicInfo } = content;
  return (
    <div className="text-[9px] leading-[1.3]">
      <div className="text-center mb-1.5">
        <h1 className="text-sm font-black uppercase tracking-wider">{basicInfo.fullName || "Your Name"}</h1>
        <p className="text-gray-500 text-[8px]">{[basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join(" • ")}</p>
      </div>
      <div className="border-t border-gray-300 pt-1">
        {content.summary && <p className="mb-1.5">{content.summary}</p>}
        <div className="grid grid-cols-3 gap-2 mb-1.5">
          <div className="col-span-1">
            {content.skills.length > 0 && <><p className="font-black uppercase text-[8px] text-gray-500 mb-0.5">Skills</p><p>{content.skills.join(", ")}</p></>}
            {content.education.filter(e => e.degree).length > 0 && (
              <><p className="font-black uppercase text-[8px] text-gray-500 mb-0.5 mt-1">Education</p>{content.education.filter(e => e.degree).map((e, i) => (
                <div key={i} className="mb-0.5"><span className="font-bold">{e.degree}</span><br />{e.college} {e.year}</div>
              ))}</>
            )}
            {content.certifications.filter(c => c.name).length > 0 && (
              <><p className="font-black uppercase text-[8px] text-gray-500 mb-0.5 mt-1">Certs</p>{content.certifications.filter(c => c.name).map((c, i) => (
                <div key={i}>{c.name}</div>
              ))}</>
            )}
          </div>
          <div className="col-span-2 border-l border-gray-200 pl-2">
            {content.experience.filter(e => e.company).length > 0 && (
              <><p className="font-black uppercase text-[8px] text-gray-500 mb-0.5">Experience</p>{content.experience.filter(e => e.company).map((e, i) => (
                <div key={i} className="mb-1"><span className="font-bold">{e.role}</span> — {e.company} ({e.duration})<br />{e.responsibilities}</div>
              ))}</>
            )}
            {content.projects.filter(p => p.name).length > 0 && (
              <><p className="font-black uppercase text-[8px] text-gray-500 mb-0.5 mt-1">Projects</p>{content.projects.filter(p => p.name).map((p, i) => (
                <div key={i} className="mb-1"><span className="font-bold">{p.name}</span> ({p.techStack})<br />{p.description}</div>
              ))}</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
