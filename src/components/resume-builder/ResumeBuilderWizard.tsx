import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { ResumeContent, emptyResumeContent, type TemplateId } from "@/lib/resume-builder-types";
import { StepBasicInfo } from "./steps/StepBasicInfo";
import { StepSummary } from "./steps/StepSummary";
import { StepSkills } from "./steps/StepSkills";
import { StepEducation } from "./steps/StepEducation";
import { StepProjects } from "./steps/StepProjects";
import { StepExperience } from "./steps/StepExperience";
import { StepCertifications } from "./steps/StepCertifications";
import { TemplateGallery } from "./TemplateGallery";

// Step 0 is template selection; steps 1-7 are content steps
const CONTENT_STEPS = [
  { title: "Basic Info", subtitle: "Your contact details" },
  { title: "Summary", subtitle: "Professional summary" },
  { title: "Skills", subtitle: "Technical & soft skills" },
  { title: "Education", subtitle: "Academic background" },
  { title: "Projects", subtitle: "Key projects" },
  { title: "Experience", subtitle: "Work history (optional)" },
  { title: "Certifications", subtitle: "Certifications (optional)" },
];

const TOTAL_STEPS = 1 + CONTENT_STEPS.length; // step 0 + 7

interface Props {
  onSubmit: (content: ResumeContent, templateId: TemplateId) => void;
  submitting: boolean;
  initialContent?: ResumeContent;
  initialTemplateId?: TemplateId;
}

export function ResumeBuilderWizard({ onSubmit, submitting, initialContent, initialTemplateId }: Props) {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<TemplateId | null>(initialTemplateId ?? null);
  const [content, setContent] = useState<ResumeContent>(initialContent || emptyResumeContent);

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const contentStep = step - 1; // 0-indexed into CONTENT_STEPS

  const canGoNext = () => {
    if (step === 0) return templateId !== null;
    if (contentStep === 0) {
      const { fullName, email } = content.basicInfo;
      return fullName.trim() !== "" && email.trim() !== "";
    }
    if (contentStep === 1) return content.summary.trim() !== "";
    if (contentStep === 2) return content.skills.length > 0;
    if (contentStep === 3) return content.education.some((e) => e.degree.trim() && e.college.trim());
    if (contentStep === 4) return content.projects.some((p) => p.name.trim() && p.description.trim());
    return true;
  };

  const updateContent = (partial: Partial<ResumeContent>) => {
    setContent((prev) => ({ ...prev, ...partial }));
  };

  const stepComponents = useMemo(() => [
    <StepBasicInfo key="basic" data={content.basicInfo} onChange={(basicInfo) => updateContent({ basicInfo })} />,
    <StepSummary key="summary" value={content.summary} onChange={(summary) => updateContent({ summary })} />,
    <StepSkills key="skills" skills={content.skills} onChange={(skills) => updateContent({ skills })} />,
    <StepEducation key="edu" items={content.education} onChange={(education) => updateContent({ education })} />,
    <StepProjects key="proj" items={content.projects} onChange={(projects) => updateContent({ projects })} />,
    <StepExperience key="exp" items={content.experience} onChange={(experience) => updateContent({ experience })} />,
    <StepCertifications key="cert" items={content.certifications} onChange={(certifications) => updateContent({ certifications })} />,
  ], [content]);

  const stepTitle = step === 0 ? "Choose Template" : CONTENT_STEPS[contentStep].title;
  const stepSubtitle = step === 0 ? "Pick a layout for your resume" : CONTENT_STEPS[contentStep].subtitle;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            Step {step + 1} of {TOTAL_STEPS}
          </span>
          <span className="text-sm font-medium text-primary">{stepTitle}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Step title */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{stepTitle}</h2>
        <p className="text-sm text-muted-foreground">{stepSubtitle}</p>
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {step === 0 ? (
            <TemplateGallery selected={templateId} onSelect={setTemplateId} />
          ) : (
            stepComponents[contentStep]
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        {step < TOTAL_STEPS - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}>
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={() => onSubmit(content, templateId!)} disabled={submitting || !canGoNext()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Enhancing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" /> Generate Resume
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
