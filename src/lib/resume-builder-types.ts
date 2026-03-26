export interface BasicInfo {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
}

export interface Education {
  degree: string;
  college: string;
  year: string;
}

export interface Project {
  name: string;
  description: string;
  techStack: string;
}

export interface Experience {
  company: string;
  role: string;
  duration: string;
  responsibilities: string;
}

export interface Certification {
  name: string;
  issuer: string;
  year: string;
}

export interface ResumeContent {
  basicInfo: BasicInfo;
  summary: string;
  skills: string[];
  education: Education[];
  projects: Project[];
  experience: Experience[];
  certifications: Certification[];
}

export interface ResumeBuilderData {
  id: string;
  user_id: string;
  content_json: ResumeContent;
  enhanced_json: ResumeContent | null;
  template_id: string;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TEMPLATE_IDS = [
  "minimal-ats",
  "modern-professional",
  "clean-fresher",
  "tech-bold",
  "compact-onepage",
] as const;

export type TemplateId = typeof TEMPLATE_IDS[number];

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  "minimal-ats": "Minimal ATS",
  "modern-professional": "Modern Professional",
  "clean-fresher": "Clean Fresher",
  "tech-bold": "Tech Bold",
  "compact-onepage": "Compact One-Page",
};

export const emptyResumeContent: ResumeContent = {
  basicInfo: { fullName: "", email: "", phone: "", linkedin: "", github: "" },
  summary: "",
  skills: [],
  education: [{ degree: "", college: "", year: "" }],
  projects: [{ name: "", description: "", techStack: "" }],
  experience: [],
  certifications: [],
};
