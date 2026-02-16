import { TemplateType } from "@/lib/pdf-generator";
import { Card, CardContent } from "@/components/ui/card";

interface FixedContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

function SectionHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${className}`}>{children}</h4>;
}

function ClassicPreview({ content }: { content: FixedContent }) {
  return (
    <div className="font-serif">
      <div className="text-center border-b border-foreground pb-3 mb-4">
        <h3 className="text-2xl font-bold">{content.name}</h3>
        <p className="text-sm text-muted-foreground">{content.email}{content.phone ? ` | ${content.phone}` : ""}</p>
      </div>
      <SectionHeader>Professional Summary</SectionHeader>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{content.summary}</p>
      {content.experience?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Professional Experience</SectionHeader>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between"><p className="font-bold text-sm">{exp.title}</p><span className="text-xs text-muted-foreground">{exp.duration}</span></div>
                <p className="text-xs text-muted-foreground mb-1">{exp.company}</p>
                <ul className="space-y-0.5">{exp.bullets.map((b, j) => <li key={j} className="text-sm text-muted-foreground">• {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Education</SectionHeader>
          {content.education.map((edu, i) => <div key={i} className="mb-1"><p className="font-medium text-sm">{edu.degree}</p><p className="text-xs text-muted-foreground">{edu.school} — {edu.year}</p></div>)}
        </>
      )}
      {content.skills?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Skills</SectionHeader>
          <p className="text-sm text-muted-foreground">{content.skills.join("  |  ")}</p>
        </>
      )}
    </div>
  );
}

function ModernPreview({ content }: { content: FixedContent }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-8 bg-blue-500 rounded-full" />
        <h3 className="text-2xl font-bold uppercase tracking-wide">{content.name}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-3 ml-4">{content.email}{content.phone ? `  •  ${content.phone}` : ""}</p>
      <div className="h-0.5 bg-blue-500 mb-4" />

      <SectionHeader className="text-blue-400">About</SectionHeader>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{content.summary}</p>

      {content.skills?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400">Technical Skills</SectionHeader>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {content.skills.map((s, i) => <span key={i} className="text-xs px-2.5 py-1 rounded border border-blue-500/20 bg-blue-500/5 text-foreground">{s}</span>)}
          </div>
        </>
      )}

      {content.experience?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400">Experience</SectionHeader>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <p className="font-bold text-sm">{exp.title}</p>
                <p className="text-xs text-muted-foreground mb-1">{exp.company}  ·  {exp.duration}</p>
                <ul className="space-y-0.5">{exp.bullets.map((b, j) => <li key={j} className="text-sm text-muted-foreground">▸ {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}

      {content.education?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400 mt-4">Education</SectionHeader>
          {content.education.map((edu, i) => <p key={i} className="text-sm text-muted-foreground">{edu.degree} — {edu.school} ({edu.year})</p>)}
        </>
      )}
    </div>
  );
}

function ExecutivePreview({ content }: { content: FixedContent }) {
  return (
    <div>
      <h3 className="text-3xl font-bold uppercase tracking-tight text-foreground">{content.name}</h3>
      {content.experience?.length > 0 && <p className="text-sm text-amber-500 font-medium mt-0.5">{content.experience[0].title}</p>}
      <p className="text-xs text-muted-foreground mt-1">{content.email}{content.phone ? `  |  ${content.phone}` : ""}</p>
      <div className="mt-3 mb-4">
        <div className="h-[2px] bg-foreground/70" />
        <div className="h-[1px] bg-amber-500/60 mt-0.5" />
      </div>

      <SectionHeader className="text-foreground">Executive Summary</SectionHeader>
      <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{content.summary}</p>

      {content.experience?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 mb-3" />
          <SectionHeader className="text-foreground">Professional Experience</SectionHeader>
          <div className="space-y-4">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <p className="font-bold text-sm uppercase">{exp.title}</p>
                <div className="flex justify-between"><p className="text-xs text-amber-500 font-medium">{exp.company}</p><span className="text-xs text-muted-foreground">{exp.duration}</span></div>
                <ul className="mt-1 space-y-0.5">{exp.bullets.map((b, j) => <li key={j} className="text-sm text-muted-foreground">— {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}

      {content.education?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 my-4" />
          <SectionHeader className="text-foreground">Education</SectionHeader>
          {content.education.map((edu, i) => <div key={i} className="mb-1"><p className="font-medium text-sm">{edu.degree}</p><p className="text-xs text-muted-foreground">{edu.school}  •  {edu.year}</p></div>)}
        </>
      )}

      {content.skills?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 my-4" />
          <SectionHeader className="text-foreground">Core Competencies</SectionHeader>
          <p className="text-sm text-muted-foreground">{content.skills.join("  •  ")}</p>
        </>
      )}
    </div>
  );
}

function MinimalPreview({ content }: { content: FixedContent }) {
  return (
    <div>
      <h3 className="text-xl font-bold">{content.name}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{content.email}{content.phone ? `  ·  ${content.phone}` : ""}</p>
      <div className="h-[0.5px] bg-muted-foreground/20 my-4" />
      <p className="text-sm text-foreground leading-relaxed mb-4">{content.summary}</p>

      {content.experience?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-3">Experience</p>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between"><p className="font-bold text-sm">{exp.title}</p><span className="text-xs text-muted-foreground">{exp.duration}</span></div>
                <p className="text-xs text-muted-foreground mb-1">{exp.company}</p>
                <ul className="space-y-0.5">{exp.bullets.map((b, j) => <li key={j} className="text-[13px] text-foreground">· {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}

      {content.education?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-2">Education</p>
          {content.education.map((edu, i) => <p key={i} className="text-sm text-foreground">{edu.degree}, {edu.school} — {edu.year}</p>)}
        </>
      )}

      {content.skills?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-2">Skills</p>
          <p className="text-sm text-foreground">{content.skills.join(", ")}</p>
        </>
      )}
    </div>
  );
}

function ImpactPreview({ content }: { content: FixedContent }) {
  const topAchievements = content.experience?.flatMap(e => e.bullets).slice(0, 3) || [];

  return (
    <div>
      <div className="bg-emerald-500/5 -mx-6 -mt-6 px-6 py-4 mb-4 rounded-t-lg sm:-mx-10 sm:px-10">
        <h3 className="text-2xl font-bold uppercase">{content.name}</h3>
        <p className="text-sm text-muted-foreground">{content.email}{content.phone ? `  |  ${content.phone}` : ""}</p>
      </div>

      <SectionHeader className="text-emerald-400">Value Proposition</SectionHeader>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{content.summary}</p>

      {topAchievements.length > 0 && (
        <div className="bg-emerald-500/5 rounded-lg p-4 mb-4">
          <SectionHeader className="text-emerald-400">Key Achievements</SectionHeader>
          <ul className="space-y-1.5">
            {topAchievements.map((a, i) => <li key={i} className="text-sm font-semibold text-foreground">★  {a}</li>)}
          </ul>
        </div>
      )}

      {content.experience?.length > 0 && (
        <>
          <div className="h-[1px] bg-emerald-500/30 my-3" />
          <SectionHeader className="text-emerald-400">Career Progression</SectionHeader>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between"><p className="font-bold text-sm">{exp.title}</p><span className="text-xs text-muted-foreground">{exp.duration}</span></div>
                <p className="text-xs text-emerald-400 mb-1">{exp.company}</p>
                <ul className="space-y-0.5">{exp.bullets.map((b, j) => <li key={j} className="text-sm text-muted-foreground">▶ {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}

      {content.education?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-emerald-500/30 my-3" />
          <SectionHeader className="text-emerald-400">Education</SectionHeader>
          {content.education.map((edu, i) => <div key={i} className="mb-1"><p className="font-medium text-sm">{edu.degree}</p><p className="text-xs text-muted-foreground">{edu.school} — {edu.year}</p></div>)}
        </>
      )}

      {content.skills?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-emerald-500/30 my-3" />
          <SectionHeader className="text-emerald-400">Core Skills</SectionHeader>
          <p className="text-sm text-muted-foreground">{content.skills.join("  ·  ")}</p>
        </>
      )}
    </div>
  );
}

export default function ResumePreview({ content, template }: { content: FixedContent; template: TemplateType }) {
  return (
    <Card className="glass">
      <CardContent className="py-8 px-6 sm:px-10">
        {template === "classic" && <ClassicPreview content={content} />}
        {template === "modern" && <ModernPreview content={content} />}
        {template === "executive" && <ExecutivePreview content={content} />}
        {template === "minimal" && <MinimalPreview content={content} />}
        {template === "impact" && <ImpactPreview content={content} />}
      </CardContent>
    </Card>
  );
}
