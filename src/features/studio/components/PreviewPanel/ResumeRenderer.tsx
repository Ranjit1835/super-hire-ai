import { motion } from "framer-motion";
import type { ResumeJSON, StudioTemplateId, ResumeChange } from "../../types/studio.types";
import { STUDIO_TEMPLATES } from "../../types/studio.types";
import { getChangeKey, getSectionFromPath } from "../../lib/resumeDiff";

interface ResumeRendererProps {
  json: ResumeJSON;
  templateId: StudioTemplateId;
  pendingChanges?: ResumeChange[];
  scale?: number;
}

export function ResumeRenderer({ json, templateId, pendingChanges = [], scale = 1 }: ResumeRendererProps) {
  const template = STUDIO_TEMPLATES.find((t) => t.id === templateId) || STUDIO_TEMPLATES[0];
  const changedSections = new Set(pendingChanges.map((c) => getSectionFromPath(c.path)));
  const changedPaths = new Set(pendingChanges.map((c) => c.path));

  const sectionHighlight = (section: string) =>
    changedSections.has(section)
      ? "ring-2 ring-cyan-400/40 bg-cyan-400/5 transition-all duration-700"
      : "";

  const bulletHighlight = (path: string) =>
    changedPaths.has(path)
      ? "bg-emerald-500/10 border-l-2 border-emerald-400 pl-2 transition-all duration-500"
      : "";

  return (
    <div
      className="bg-white text-black rounded-lg shadow-2xl overflow-hidden"
      style={{
        fontFamily: template.fontFamily,
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        width: "210mm",
        minHeight: "297mm",
        maxWidth: "100%",
      }}
    >
      <div className="p-8">
        {/* Personal Info / Header */}
        <motion.div
          layout
          className={`text-center mb-6 pb-4 border-b-2 ${sectionHighlight("personal_info")}`}
          style={{ borderColor: template.accentColor }}
        >
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: template.accentColor }}>
            {json.personal_info?.name || "Your Name"}
          </h1>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-600">
            {json.personal_info?.email && <span>{json.personal_info.email}</span>}
            {json.personal_info?.phone && <span>{json.personal_info.phone}</span>}
            {json.personal_info?.location && <span>{json.personal_info.location}</span>}
            {json.personal_info?.linkedin && <span>{json.personal_info.linkedin}</span>}
            {json.personal_info?.github && <span>{json.personal_info.github}</span>}
            {json.personal_info?.portfolio && <span>{json.personal_info.portfolio}</span>}
          </div>
        </motion.div>

        {/* Summary */}
        {json.summary && (
          <motion.div layout className={`mb-5 ${sectionHighlight("summary")}`}>
            <SectionTitle title="Professional Summary" color={template.accentColor} />
            <p className="text-sm leading-relaxed text-gray-700">{json.summary}</p>
          </motion.div>
        )}

        {/* Experience */}
        {json.experience?.length > 0 && (
          <motion.div layout className={`mb-5 ${sectionHighlight("experience")}`}>
            <SectionTitle title="Experience" color={template.accentColor} />
            {json.experience.map((exp, i) => (
              <div key={i} className="mb-4 last:mb-0">
                <div className="flex justify-between items-baseline">
                  <div>
                    <span className="font-semibold text-sm">{exp.role}</span>
                    {exp.company && <span className="text-sm text-gray-600"> — {exp.company}</span>}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                    {exp.start_date} – {exp.end_date}
                  </span>
                </div>
                {exp.location && <p className="text-xs text-gray-500">{exp.location}</p>}
                <ul className="mt-1.5 space-y-1">
                  {exp.bullets?.map((bullet, j) => {
                    const path = `experience[${i}].bullets[${j}]`;
                    return (
                      <li key={j} className={`text-sm text-gray-700 pl-4 relative ${bulletHighlight(path)}`}>
                        <span className="absolute left-0 top-[0.55em] w-1.5 h-1.5 rounded-full bg-gray-400" />
                        {bullet}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </motion.div>
        )}

        {/* Education */}
        {json.education?.length > 0 && (
          <motion.div layout className={`mb-5 ${sectionHighlight("education")}`}>
            <SectionTitle title="Education" color={template.accentColor} />
            {json.education.map((edu, i) => (
              <div key={i} className="mb-2 last:mb-0">
                <div className="flex justify-between items-baseline">
                  <div>
                    <span className="font-semibold text-sm">{edu.degree} {edu.field && `in ${edu.field}`}</span>
                    {edu.institution && <span className="text-sm text-gray-600"> — {edu.institution}</span>}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{edu.year}</span>
                </div>
                {edu.gpa && <p className="text-xs text-gray-500">GPA: {edu.gpa}</p>}
              </div>
            ))}
          </motion.div>
        )}

        {/* Skills */}
        {json.skills?.length > 0 && (
          <motion.div layout className={`mb-5 ${sectionHighlight("skills")}`}>
            <SectionTitle title="Skills" color={template.accentColor} />
            <div className="space-y-1.5">
              {json.skills.map((cat, i) => (
                <div key={i} className="text-sm">
                  <span className="font-semibold text-gray-800">{cat.category}: </span>
                  <span className="text-gray-700">{cat.items?.join(", ")}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Projects */}
        {json.projects?.length > 0 && (
          <motion.div layout className={`mb-5 ${sectionHighlight("projects")}`}>
            <SectionTitle title="Projects" color={template.accentColor} />
            {json.projects.map((proj, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-sm">{proj.name}</span>
                  {proj.tech?.length > 0 && (
                    <span className="text-xs text-gray-500">({proj.tech.join(", ")})</span>
                  )}
                </div>
                {proj.description && <p className="text-xs text-gray-600 mt-0.5">{proj.description}</p>}
                {proj.bullets?.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {proj.bullets.map((bullet, j) => {
                      const path = `projects[${i}].bullets[${j}]`;
                      return (
                        <li key={j} className={`text-sm text-gray-700 pl-4 relative ${bulletHighlight(path)}`}>
                          <span className="absolute left-0 top-[0.55em] w-1.5 h-1.5 rounded-full bg-gray-400" />
                          {bullet}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </motion.div>
        )}

        {/* Certifications */}
        {json.certifications?.length > 0 && (
          <motion.div layout className={`mb-5 ${sectionHighlight("certifications")}`}>
            <SectionTitle title="Certifications" color={template.accentColor} />
            <div className="space-y-1">
              {json.certifications.map((cert, i) => (
                <div key={i} className="text-sm">
                  <span className="font-semibold">{cert.name}</span>
                  {cert.issuer && <span className="text-gray-600"> — {cert.issuer}</span>}
                  {cert.year && <span className="text-gray-500 text-xs ml-1">({cert.year})</span>}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Extras */}
        {(json.extras?.languages?.length > 0 || json.extras?.awards?.length > 0) && (
          <motion.div layout className={sectionHighlight("extras")}>
            {json.extras.languages?.length > 0 && (
              <>
                <SectionTitle title="Languages" color={template.accentColor} />
                <p className="text-sm text-gray-700 mb-3">{json.extras.languages.join(", ")}</p>
              </>
            )}
            {json.extras.awards?.length > 0 && (
              <>
                <SectionTitle title="Awards" color={template.accentColor} />
                <ul className="space-y-0.5">
                  {json.extras.awards.map((a, i) => (
                    <li key={i} className="text-sm text-gray-700 pl-4 relative">
                      <span className="absolute left-0 top-[0.55em] w-1.5 h-1.5 rounded-full bg-gray-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, color }: { title: string; color: string }) {
  return (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-2 pb-1 border-b"
      style={{ color, borderColor: `${color}40` }}
    >
      {title}
    </h2>
  );
}
