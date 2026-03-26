import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { ResumeContent, emptyResumeContent } from "@/lib/resume-builder-types";
import { StepBasicInfo } from "./steps/StepBasicInfo";
import { StepSummary } from "./steps/StepSummary";
import { StepSkills } from "./steps/StepSkills";
import { StepEducation } from "./steps/StepEducation";
import { StepProjects } from "./steps/StepProjects";
import { StepExperience } from "./steps/StepExperience";
import { StepCertifications } from "./steps/StepCertifications";

const STEPS = [
  { title: "Basic Info", subtitle: "Your contact details" },
  { title: "Summary", subtitle: "Professional summary" },
  { title: "Skills", subtitle: "Technical & soft skills" },
  { title: "Education", subtitle: "Academic background" },
  { title: "Projects", subtitle: "Key projects" },
  { title: "Experience", subtitle: "Work history (optional)" },
  { title: "Certifications", subtitle: "Certifications (optional)" },
];

interface Props {
  onSubmit: (content: ResumeContent) => void;
  submitting: boolean;
  initialContent?: ResumeContent;
}

export function ResumeBuilderWizard({ onSubmit, submitting, initialContent }: Props) {
  const [step, setStep] = useState(0);
  const [content, setContent] = useState<ResumeContent>(initialContent || emptyResumeContent);

  const progress = ((step + 1) / STEPS.length) * 100;

  const canGoNext = () => {
    if (step === 0) {
      const { fullName, email } = content.basicInfo;
      return fullName.trim() !== "" && email.trim() !== "";
    }
    if (step === 1) return content.summary.trim() !== "";
    if (step === 2) return content.skills.length > 0;
    if (step === 3) return content.education.some((e) => e.degree.trim() && e.college.trim());
    if (step === 4) return content.projects.some((p) => p.name.trim() && p.description.trim());
    return true; // optional steps
  };

  const updateContent = (partial: Partial<ResumeContent>) => {
    setContent((prev) => ({ ...prev, ...partial }));
  };

  const stepComponents = [
    <StepBasicInfo key="basic" data={content.basicInfo} onChange={(basicInfo) => updateContent({ basicInfo })} />,
    <StepSummary key="summary" value={content.summary} onChange={(summary) => updateContent({ summary })} />,
    <StepSkills key="skills" skills={content.skills} onChange={(skills) => updateContent({ skills })} />,
    <StepEducation key="edu" items={content.education} onChange={(education) => updateContent({ education })} />,
    <StepProjects key="proj" items={content.projects} onChange={(projects) => updateContent({ projects })} />,
    <StepExperience key="exp" items={content.experience} onChange={(experience) => updateContent({ experience })} />,
    <StepCertifications key="cert" items={content.certifications} onChange={(certifications) => updateContent({ certifications })} />,
  ];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="text-sm font-medium text-primary">{STEPS[step].title}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Step title */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{STEPS[step].title}</h2>
        <p className="text-sm text-muted-foreground">{STEPS[step].subtitle}</p>
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
          {stepComponents[step]}
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

        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}>
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={() => onSubmit(content)} disabled={submitting || !canGoNext()}>
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
