import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { TEMPLATE_METADATA, type TemplateId, type ResumeContent } from "@/lib/resume-builder-types";
import { ResumeTemplatePreview } from "./ResumeTemplatePreview";

const SAMPLE_CONTENT: ResumeContent = {
  basicInfo: {
    fullName: "Priya Sharma",
    email: "priya.sharma@email.com",
    phone: "+91 98765 43210",
    linkedin: "linkedin.com/in/priyasharma",
    github: "github.com/priyasharma",
  },
  summary:
    "Results-driven Software Engineer with 3 years of experience building scalable web applications. Proficient in React, Node.js, and cloud technologies. Passionate about clean code and delivering user-centric solutions.",
  skills: ["React", "TypeScript", "Node.js", "Python", "PostgreSQL", "AWS", "Docker", "Git", "REST APIs", "Agile"],
  education: [
    {
      degree: "B.Tech in Computer Science",
      college: "Indian Institute of Technology, Hyderabad",
      year: "2021",
    },
  ],
  projects: [
    {
      name: "E-Commerce Platform",
      description:
        "Built a full-stack e-commerce platform with real-time inventory management, payment integration, and admin dashboard. Reduced page load time by 40%.",
      techStack: "React, Node.js, PostgreSQL, Stripe, AWS S3",
    },
    {
      name: "AI Resume Analyzer",
      description:
        "Developed an NLP-based tool that analyzes resumes for ATS compatibility and provides improvement suggestions. Achieved 92% accuracy on benchmark dataset.",
      techStack: "Python, FastAPI, spaCy, React, Supabase",
    },
  ],
  experience: [
    {
      company: "TechCorp Solutions",
      role: "Software Engineer",
      duration: "June 2021 – Present",
      responsibilities:
        "Led development of microservices architecture serving 50K+ daily users. Implemented CI/CD pipelines reducing deployment time by 60%. Mentored 2 junior developers.",
    },
  ],
  certifications: [
    {
      name: "AWS Certified Developer – Associate",
      issuer: "Amazon Web Services",
      year: "2022",
    },
  ],
};

interface Props {
  open: boolean;
  templateId: TemplateId | null;
  onClose: () => void;
  onSelect: (id: TemplateId) => void;
  selectedId: TemplateId | null;
}

export function TemplatePreviewModal({ open, templateId, onClose, onSelect, selectedId }: Props) {
  if (!templateId) return null;

  const meta = TEMPLATE_METADATA[templateId];
  const isSelected = selectedId === templateId;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base">Template Preview</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{meta.name} · {meta.category}</p>
            </div>
            <div className="flex items-center gap-2">
              {meta.isNew && <Badge className="text-xs bg-primary text-primary-foreground">New</Badge>}
            </div>
          </div>
        </DialogHeader>

        {/* Preview — ResumeTemplatePreview has its own prev/next and template navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          <ResumeTemplatePreview
            content={SAMPLE_CONTENT}
            templateId={templateId}
            onTemplateChange={onSelect}
            isPaid={true}
          />
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-border shrink-0 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Preview uses sample data · Use prev/next to browse</p>
          <Button
            onClick={() => { onClose(); }}
            variant={isSelected ? "default" : "outline"}
            className="gap-2"
          >
            {isSelected && <CheckCircle2 className="h-4 w-4" />}
            {isSelected ? "Template Selected ✓" : "Use This Template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
