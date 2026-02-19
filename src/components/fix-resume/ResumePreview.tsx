import { TemplateType } from "@/lib/pdf-generator";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

export interface FixedContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

interface Props {
  content: FixedContent;
  template: TemplateType;
  editable?: boolean;
  onContentChange?: (content: FixedContent) => void;
}

function EditableText({ value, onChange, className = "", multiline = false }: {
  value: string; onChange: (v: string) => void; className?: string; multiline?: boolean;
}) {
  if (multiline) {
    return <Textarea value={value} onChange={(e) => onChange(e.target.value)} className={`bg-transparent border-dashed border-primary/30 focus:border-primary/60 resize-none ${className}`} />;
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} className={`bg-transparent border-dashed border-primary/30 focus:border-primary/60 h-auto py-0.5 ${className}`} />;
}

function EditableBullet({ value, onChange, onRemove, prefix }: {
  value: string; onChange: (v: string) => void; onRemove: () => void; prefix: string;
}) {
  return (
    <li className="flex items-start gap-1 group">
      <span className="shrink-0 mt-2">{prefix}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent border-dashed border-primary/30 focus:border-primary/60 h-auto py-0.5 text-sm flex-1" />
      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0" onClick={onRemove}>
        <X className="h-3 w-3 text-destructive" />
      </Button>
    </li>
  );
}

function SectionHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${className}`}>{children}</h4>;
}

// Helper to update nested content
function useEditor(content: FixedContent, onContentChange?: (c: FixedContent) => void, editable?: boolean) {
  const update = (patch: Partial<FixedContent>) => onContentChange?.({ ...content, ...patch });
  const updateExp = (idx: number, patch: Partial<FixedContent["experience"][0]>) => {
    const exp = [...content.experience];
    exp[idx] = { ...exp[idx], ...patch };
    update({ experience: exp });
  };
  const updateBullet = (expIdx: number, bulletIdx: number, val: string) => {
    const exp = [...content.experience];
    const bullets = [...exp[expIdx].bullets];
    bullets[bulletIdx] = val;
    exp[expIdx] = { ...exp[expIdx], bullets };
    update({ experience: exp });
  };
  const removeBullet = (expIdx: number, bulletIdx: number) => {
    const exp = [...content.experience];
    exp[expIdx] = { ...exp[expIdx], bullets: exp[expIdx].bullets.filter((_, i) => i !== bulletIdx) };
    update({ experience: exp });
  };
  const updateEdu = (idx: number, patch: Partial<FixedContent["education"][0]>) => {
    const edu = [...content.education];
    edu[idx] = { ...edu[idx], ...patch };
    update({ education: edu });
  };
  const updateSkill = (idx: number, val: string) => {
    const skills = [...content.skills];
    skills[idx] = val;
    update({ skills });
  };
  const removeSkill = (idx: number) => {
    update({ skills: content.skills.filter((_, i) => i !== idx) });
  };
  const addSkill = () => {
    update({ skills: [...content.skills, "New Skill"] });
  };
  return { update, updateExp, updateBullet, removeBullet, updateEdu, updateSkill, removeSkill, addSkill, isEditable: editable && !!onContentChange };
}

// ─── Editable contact row ──────────────────────────────────────────
function EditableContact({ content, editor, separator = "|" }: { content: FixedContent; editor: ReturnType<typeof useEditor>; separator?: string }) {
  if (!editor.isEditable) {
    return <p className="text-sm text-muted-foreground">{content.email}{content.phone ? ` ${separator} ${content.phone}` : ""}</p>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <EditableText value={content.email} onChange={(v) => editor.update({ email: v })} className="text-sm w-auto" />
      <span className="text-muted-foreground text-xs">{separator}</span>
      <EditableText value={content.phone || ""} onChange={(v) => editor.update({ phone: v })} className="text-sm w-auto" />
    </div>
  );
}

// ─── Editable education section ──────────────────────────────────────
function EditableEducation({ content, editor, format }: { content: FixedContent; editor: ReturnType<typeof useEditor>; format: "inline" | "stacked" }) {
  if (!editor.isEditable) {
    if (format === "inline") {
      return <>{content.education?.map((edu, i) => <p key={i} className="text-sm text-muted-foreground">{edu.degree} - {edu.school} ({edu.year})</p>)}</>;
    }
    return <>{content.education?.map((edu, i) => <div key={i} className="mb-1"><p className="font-medium text-sm">{edu.degree}</p><p className="text-xs text-muted-foreground">{edu.school} - {edu.year}</p></div>)}</>;
  }
  return (
    <>
      {content.education?.map((edu, i) => (
        <div key={i} className="mb-2 space-y-1">
          <EditableText value={edu.degree} onChange={(v) => editor.updateEdu(i, { degree: v })} className="font-medium text-sm" />
          <div className="flex items-center gap-2">
            <EditableText value={edu.school} onChange={(v) => editor.updateEdu(i, { school: v })} className="text-xs" />
            <EditableText value={edu.year} onChange={(v) => editor.updateEdu(i, { year: v })} className="text-xs w-20" />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Editable skills section ──────────────────────────────────────────
function EditableSkills({ content, editor, display }: { content: FixedContent; editor: ReturnType<typeof useEditor>; display: "inline" | "tags" }) {
  if (!editor.isEditable) {
    if (display === "tags") {
      return <div className="flex flex-wrap gap-1.5">{content.skills?.map((s, i) => <span key={i} className="text-xs px-2.5 py-1 rounded border border-blue-500/20 bg-blue-500/5 text-foreground">{s}</span>)}</div>;
    }
    return <p className="text-sm text-muted-foreground">{content.skills?.join("  |  ")}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {content.skills?.map((s, i) => (
        <div key={i} className="flex items-center gap-0.5 group">
          <Input value={s} onChange={(e) => editor.updateSkill(i, e.target.value)} className="bg-transparent border-dashed border-primary/30 h-auto py-0.5 text-xs w-24" />
          <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => editor.removeSkill(i)}>
            <X className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 text-xs text-primary" onClick={editor.addSkill}>
        <Plus className="h-3 w-3 mr-1" /> Add
      </Button>
    </div>
  );
}

// ─── Editable experience company/duration ──────────────────────────
function EditableExpMeta({ exp, idx, editor, layout }: { exp: FixedContent["experience"][0]; idx: number; editor: ReturnType<typeof useEditor>; layout: "row" | "stacked" }) {
  if (!editor.isEditable) {
    if (layout === "row") {
      return (
        <div className="flex justify-between">
          <p className="text-xs text-muted-foreground">{exp.company}</p>
          <span className="text-xs text-muted-foreground shrink-0">{exp.duration}</span>
        </div>
      );
    }
    return <p className="text-xs text-muted-foreground mb-1">{exp.company}  -  {exp.duration}</p>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <EditableText value={exp.company} onChange={(v) => editor.updateExp(idx, { company: v })} className="text-xs" />
      <EditableText value={exp.duration} onChange={(v) => editor.updateExp(idx, { duration: v })} className="text-xs w-32" />
    </div>
  );
}

function ClassicPreview({ content, editable, onContentChange }: Props) {
  const editor = useEditor(content, onContentChange, editable);
  return (
    <div className="font-serif">
      <div className="text-center border-b border-foreground pb-3 mb-4">
        {editor.isEditable ? <EditableText value={content.name} onChange={(v) => editor.update({ name: v })} className="text-2xl font-bold text-center" /> : <h3 className="text-2xl font-bold">{content.name}</h3>}
        <EditableContact content={content} editor={editor} />
      </div>
      <SectionHeader>Professional Summary</SectionHeader>
      {editor.isEditable ? <EditableText value={content.summary} onChange={(v) => editor.update({ summary: v })} multiline className="text-sm mb-4" /> : <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{content.summary}</p>}
      {content.experience?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Professional Experience</SectionHeader>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between">
                  {editor.isEditable ? <EditableText value={exp.title} onChange={(v) => editor.updateExp(i, { title: v })} className="font-bold text-sm" /> : <p className="font-bold text-sm">{exp.title}</p>}
                </div>
                <EditableExpMeta exp={exp} idx={i} editor={editor} layout="row" />
                <ul className="space-y-0.5 mt-1">
                  {exp.bullets.map((b, j) => editor.isEditable
                    ? <EditableBullet key={j} value={b} onChange={(v) => editor.updateBullet(i, j, v)} onRemove={() => editor.removeBullet(i, j)} prefix="-" />
                    : <li key={j} className="text-sm text-muted-foreground">- {b}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Education</SectionHeader>
          <EditableEducation content={content} editor={editor} format="stacked" />
        </>
      )}
      {content.skills?.length > 0 && (
        <>
          <div className="border-t border-muted-foreground/30 my-3" />
          <SectionHeader>Skills</SectionHeader>
          <EditableSkills content={content} editor={editor} display="inline" />
        </>
      )}
    </div>
  );
}

function ModernPreview({ content, editable, onContentChange }: Props) {
  const editor = useEditor(content, onContentChange, editable);
  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-8 bg-blue-500 rounded-full" />
        {editor.isEditable ? <EditableText value={content.name} onChange={(v) => editor.update({ name: v })} className="text-2xl font-bold uppercase tracking-wide" /> : <h3 className="text-2xl font-bold uppercase tracking-wide">{content.name}</h3>}
      </div>
      <div className="ml-4 mb-3"><EditableContact content={content} editor={editor} separator="-" /></div>
      <div className="h-0.5 bg-blue-500 mb-4" />
      <SectionHeader className="text-blue-400">About</SectionHeader>
      {editor.isEditable ? <EditableText value={content.summary} onChange={(v) => editor.update({ summary: v })} multiline className="text-sm mb-4" /> : <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{content.summary}</p>}
      {content.skills?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400">Technical Skills</SectionHeader>
          <div className="mb-4"><EditableSkills content={content} editor={editor} display="tags" /></div>
        </>
      )}
      {content.experience?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400">Experience</SectionHeader>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                {editor.isEditable ? <EditableText value={exp.title} onChange={(v) => editor.updateExp(i, { title: v })} className="font-bold text-sm" /> : <p className="font-bold text-sm">{exp.title}</p>}
                <EditableExpMeta exp={exp} idx={i} editor={editor} layout="stacked" />
                <ul className="space-y-0.5">
                  {exp.bullets.map((b, j) => editor.isEditable
                    ? <EditableBullet key={j} value={b} onChange={(v) => editor.updateBullet(i, j, v)} onRemove={() => editor.removeBullet(i, j)} prefix="-" />
                    : <li key={j} className="text-sm text-muted-foreground">- {b}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <SectionHeader className="text-blue-400 mt-4">Education</SectionHeader>
          <EditableEducation content={content} editor={editor} format="inline" />
        </>
      )}
    </div>
  );
}

function ExecutivePreview({ content, editable, onContentChange }: Props) {
  const editor = useEditor(content, onContentChange, editable);
  return (
    <div>
      {editor.isEditable ? <EditableText value={content.name} onChange={(v) => editor.update({ name: v })} className="text-3xl font-bold uppercase tracking-tight" /> : <h3 className="text-3xl font-bold uppercase tracking-tight text-foreground">{content.name}</h3>}
      {content.experience?.length > 0 && <p className="text-sm text-amber-500 font-medium mt-0.5">{content.experience[0].title}</p>}
      <div className="mt-1"><EditableContact content={content} editor={editor} /></div>
      <div className="mt-3 mb-4">
        <div className="h-[2px] bg-foreground/70" />
        <div className="h-[1px] bg-amber-500/60 mt-0.5" />
      </div>
      <SectionHeader className="text-foreground">Executive Summary</SectionHeader>
      {editor.isEditable ? <EditableText value={content.summary} onChange={(v) => editor.update({ summary: v })} multiline className="text-sm mb-5" /> : <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{content.summary}</p>}
      {content.experience?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 mb-3" />
          <SectionHeader className="text-foreground">Professional Experience</SectionHeader>
          <div className="space-y-4">
            {content.experience.map((exp, i) => (
              <div key={i}>
                {editor.isEditable ? <EditableText value={exp.title} onChange={(v) => editor.updateExp(i, { title: v })} className="font-bold text-sm uppercase" /> : <p className="font-bold text-sm uppercase">{exp.title}</p>}
                <EditableExpMeta exp={exp} idx={i} editor={editor} layout="row" />
                <ul className="mt-1 space-y-0.5">
                  {exp.bullets.map((b, j) => editor.isEditable
                    ? <EditableBullet key={j} value={b} onChange={(v) => editor.updateBullet(i, j, v)} onRemove={() => editor.removeBullet(i, j)} prefix="--" />
                    : <li key={j} className="text-sm text-muted-foreground">-- {b}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 my-4" />
          <SectionHeader className="text-foreground">Education</SectionHeader>
          <EditableEducation content={content} editor={editor} format="stacked" />
        </>
      )}
      {content.skills?.length > 0 && (
        <>
          <div className="w-24 h-[0.5px] bg-amber-500/50 my-4" />
          <SectionHeader className="text-foreground">Core Competencies</SectionHeader>
          <EditableSkills content={content} editor={editor} display="inline" />
        </>
      )}
    </div>
  );
}

function MinimalPreview({ content, editable, onContentChange }: Props) {
  const editor = useEditor(content, onContentChange, editable);
  return (
    <div>
      {editor.isEditable ? <EditableText value={content.name} onChange={(v) => editor.update({ name: v })} className="text-xl font-bold" /> : <h3 className="text-xl font-bold">{content.name}</h3>}
      <div className="mt-0.5"><EditableContact content={content} editor={editor} separator="-" /></div>
      <div className="h-[0.5px] bg-muted-foreground/20 my-4" />
      {editor.isEditable ? <EditableText value={content.summary} onChange={(v) => editor.update({ summary: v })} multiline className="text-sm mb-4" /> : <p className="text-sm text-foreground leading-relaxed mb-4">{content.summary}</p>}
      {content.experience?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-3">Experience</p>
          <div className="space-y-3">
            {content.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between">
                  {editor.isEditable ? <EditableText value={exp.title} onChange={(v) => editor.updateExp(i, { title: v })} className="font-bold text-sm" /> : <p className="font-bold text-sm">{exp.title}</p>}
                </div>
                <EditableExpMeta exp={exp} idx={i} editor={editor} layout="row" />
                <ul className="space-y-0.5 mt-1">
                  {exp.bullets.map((b, j) => editor.isEditable
                    ? <EditableBullet key={j} value={b} onChange={(v) => editor.updateBullet(i, j, v)} onRemove={() => editor.removeBullet(i, j)} prefix="-" />
                    : <li key={j} className="text-[13px] text-foreground">- {b}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-2">Education</p>
          <EditableEducation content={content} editor={editor} format="inline" />
        </>
      )}
      {content.skills?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-muted-foreground/20 my-3" />
          <p className="text-xs font-semibold text-muted-foreground mb-2">Skills</p>
          <EditableSkills content={content} editor={editor} display="inline" />
        </>
      )}
    </div>
  );
}

function ImpactPreview({ content, editable, onContentChange }: Props) {
  const editor = useEditor(content, onContentChange, editable);
  const topAchievements = content.experience?.flatMap(e => e.bullets).slice(0, 3) || [];

  return (
    <div>
      <div className="bg-emerald-500/5 -mx-6 -mt-6 px-6 py-4 mb-4 rounded-t-lg sm:-mx-10 sm:px-10">
        {editor.isEditable ? <EditableText value={content.name} onChange={(v) => editor.update({ name: v })} className="text-2xl font-bold uppercase" /> : <h3 className="text-2xl font-bold uppercase">{content.name}</h3>}
        <EditableContact content={content} editor={editor} />
      </div>
      <SectionHeader className="text-emerald-400">Value Proposition</SectionHeader>
      {editor.isEditable ? <EditableText value={content.summary} onChange={(v) => editor.update({ summary: v })} multiline className="text-sm mb-4" /> : <p className="text-sm text-muted-foreground leading-relaxed mb-4">{content.summary}</p>}
      {topAchievements.length > 0 && (
        <div className="bg-emerald-500/5 rounded-lg p-4 mb-4">
          <SectionHeader className="text-emerald-400">Key Achievements</SectionHeader>
          <ul className="space-y-1.5">
            {topAchievements.map((a, i) => <li key={i} className="text-sm font-semibold text-foreground">*  {a}</li>)}
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
                <div className="flex justify-between">
                  {editor.isEditable ? <EditableText value={exp.title} onChange={(v) => editor.updateExp(i, { title: v })} className="font-bold text-sm" /> : <p className="font-bold text-sm">{exp.title}</p>}
                </div>
                <EditableExpMeta exp={exp} idx={i} editor={editor} layout="row" />
                <ul className="space-y-0.5 mt-1">
                  {exp.bullets.map((b, j) => editor.isEditable
                    ? <EditableBullet key={j} value={b} onChange={(v) => editor.updateBullet(i, j, v)} onRemove={() => editor.removeBullet(i, j)} prefix="-" />
                    : <li key={j} className="text-sm text-muted-foreground">- {b}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {content.education?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-emerald-500/30 my-3" />
          <SectionHeader className="text-emerald-400">Education</SectionHeader>
          <EditableEducation content={content} editor={editor} format="stacked" />
        </>
      )}
      {content.skills?.length > 0 && (
        <>
          <div className="h-[0.5px] bg-emerald-500/30 my-3" />
          <SectionHeader className="text-emerald-400">Core Skills</SectionHeader>
          <EditableSkills content={content} editor={editor} display="inline" />
        </>
      )}
    </div>
  );
}

export default function ResumePreview({ content, template, editable, onContentChange }: Props) {
  return (
    <Card className="glass">
      <CardContent className="p-6 sm:p-10">
        {template === "classic" && <ClassicPreview content={content} template={template} editable={editable} onContentChange={onContentChange} />}
        {template === "modern" && <ModernPreview content={content} template={template} editable={editable} onContentChange={onContentChange} />}
        {template === "executive" && <ExecutivePreview content={content} template={template} editable={editable} onContentChange={onContentChange} />}
        {template === "minimal" && <MinimalPreview content={content} template={template} editable={editable} onContentChange={onContentChange} />}
        {template === "impact" && <ImpactPreview content={content} template={template} editable={editable} onContentChange={onContentChange} />}
      </CardContent>
    </Card>
  );
}
