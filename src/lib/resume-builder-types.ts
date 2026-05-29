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

export const TEMPLATE_CATEGORIES = ["Tech", "Fresher", "Executive", "Creative", "Minimal ATS"] as const;
export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

export const TEMPLATE_IDS = [
  "minimal-ats",
  "modern-professional",
  "clean-fresher",
  "tech-bold",
  "compact-onepage",
  "executive-clean",
  "creative-minimal",
  "two-column-pro",
  "data-tech-focused",
  "ultra-compact",
] as const;

export type TemplateId = typeof TEMPLATE_IDS[number];

export interface TemplateMetadata {
  name: string;
  category: TemplateCategory;
  description: string;
  isNew?: boolean;
}

export const TEMPLATE_METADATA: Record<TemplateId, TemplateMetadata> = {
  "minimal-ats": { name: "Minimal ATS", category: "Minimal ATS", description: "Clean, ATS-safe single column" },
  "modern-professional": { name: "Modern Professional", category: "Tech", description: "Sleek blue layout for tech roles" },
  "clean-fresher": { name: "Clean Fresher", category: "Fresher", description: "Education-first layout for new grads" },
  "tech-bold": { name: "Tech Bold", category: "Tech", description: "Monospace font, code-style headers" },
  "compact-onepage": { name: "Compact One-Page", category: "Minimal ATS", description: "Two-column compact, fits one page" },
  "executive-clean": { name: "Executive Clean", category: "Executive", description: "Bold header, polished leadership look" },
  "creative-minimal": { name: "Creative Minimal", category: "Creative", description: "Violet accents, rounded skill tags" },
  "two-column-pro": { name: "Two-Column Pro", category: "Tech", description: "Sidebar + main column, teal theme" },
  "data-tech-focused": { name: "Data/Tech Focused", category: "Tech", description: "Skills-first, monospace, cyan accents" },
  "ultra-compact": { name: "Ultra Compact", category: "Minimal ATS", description: "Maximum density, 3-column grid" },
};

/** Legacy name lookup — maps TemplateId to display name */
export const TEMPLATE_NAMES: Record<TemplateId, string> = Object.fromEntries(
  TEMPLATE_IDS.map((id) => [id, TEMPLATE_METADATA[id].name])
) as Record<TemplateId, string>;

export const emptyResumeContent: ResumeContent = {
  basicInfo: { fullName: "", email: "", phone: "", linkedin: "", github: "" },
  summary: "",
  skills: [],
  education: [{ degree: "", college: "", year: "" }],
  projects: [{ name: "", description: "", techStack: "" }],
  experience: [],
  certifications: [],
};
