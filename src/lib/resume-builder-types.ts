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
  // Original 10
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
  // Tech variants (11-20)
  "tech-dark",
  "tech-sidebar",
  "tech-minimal-color",
  "tech-two-col",
  "tech-compact-dark",
  "tech-gradient",
  "tech-monochrome",
  "tech-card-layout",
  "tech-timeline",
  "tech-accent",
  // Fresher variants (21-28)
  "fresher-simple",
  "fresher-modern",
  "fresher-colorful",
  "fresher-internship",
  "fresher-academic",
  "fresher-two-col",
  "fresher-bold",
  "fresher-clean-dark",
  // Executive variants (29-36)
  "exec-serif",
  "exec-premium",
  "exec-boardroom",
  "exec-classic",
  "exec-two-page",
  "exec-minimal",
  "exec-dark",
  "exec-timeline",
  // Creative variants (37-44)
  "creative-infographic",
  "creative-portfolio",
  "creative-sidebar",
  "creative-bold-color",
  "creative-typographic",
  "creative-icon-row",
  "creative-pastel",
  "creative-dark-accent",
  // Minimal ATS variants (45-50)
  "ats-one-col",
  "ats-two-col",
  "ats-clean-header",
  "ats-compact",
  "ats-serif",
  "ats-wide-margin",
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
  "modern-professional": { name: "Modern Professional", category: "Tech", description: "Sleek layout for tech roles" },
  "clean-fresher": { name: "Clean Fresher", category: "Fresher", description: "Simple layout for new grads" },
  "tech-bold": { name: "Tech Bold", category: "Tech", description: "Strong headers for tech positions" },
  "compact-onepage": { name: "Compact One-Page", category: "Minimal ATS", description: "Fits everything on one page" },
  "executive-clean": { name: "Executive Clean", category: "Executive", description: "Polished look for leaders" },
  "creative-minimal": { name: "Creative Minimal", category: "Creative", description: "Stand out with subtle style" },
  "two-column-pro": { name: "Two-Column Pro", category: "Tech", description: "Side-by-side layout maximizes space" },
  "data-tech-focused": { name: "Data/Tech Focused", category: "Tech", description: "Highlights technical skills upfront" },
  "ultra-compact": { name: "Ultra Compact", category: "Minimal ATS", description: "Maximum info in minimal space" },
  // Tech variants
  "tech-dark": { name: "Tech Dark", category: "Tech", description: "Dark header with accent color", isNew: true },
  "tech-sidebar": { name: "Tech Sidebar", category: "Tech", description: "Sidebar with skills & contact", isNew: true },
  "tech-minimal-color": { name: "Tech Color", category: "Tech", description: "Minimal with a color accent", isNew: true },
  "tech-two-col": { name: "Tech Two-Col", category: "Tech", description: "Two columns optimized for tech", isNew: true },
  "tech-compact-dark": { name: "Tech Compact Dark", category: "Tech", description: "Compact dark-header variant", isNew: true },
  "tech-gradient": { name: "Tech Gradient", category: "Tech", description: "Gradient header bar", isNew: true },
  "tech-monochrome": { name: "Tech Mono", category: "Tech", description: "Black & white, ultra-clean", isNew: true },
  "tech-card-layout": { name: "Tech Cards", category: "Tech", description: "Card sections for each role", isNew: true },
  "tech-timeline": { name: "Tech Timeline", category: "Tech", description: "Visual timeline of experience", isNew: true },
  "tech-accent": { name: "Tech Accent", category: "Tech", description: "Bold accent stripe layout", isNew: true },
  // Fresher variants
  "fresher-simple": { name: "Fresher Simple", category: "Fresher", description: "No-frills grad template", isNew: true },
  "fresher-modern": { name: "Fresher Modern", category: "Fresher", description: "Fresh modern look", isNew: true },
  "fresher-colorful": { name: "Fresher Colorful", category: "Fresher", description: "Light color accents", isNew: true },
  "fresher-internship": { name: "Internship Ready", category: "Fresher", description: "Highlights projects & internships", isNew: true },
  "fresher-academic": { name: "Academic", category: "Fresher", description: "Education-first layout", isNew: true },
  "fresher-two-col": { name: "Fresher Two-Col", category: "Fresher", description: "Two columns for new grads", isNew: true },
  "fresher-bold": { name: "Fresher Bold", category: "Fresher", description: "Bold name header", isNew: true },
  "fresher-clean-dark": { name: "Fresher Dark", category: "Fresher", description: "Dark header for fresher", isNew: true },
  // Executive variants
  "exec-serif": { name: "Executive Serif", category: "Executive", description: "Classic serif typography", isNew: true },
  "exec-premium": { name: "Executive Premium", category: "Executive", description: "Premium C-suite layout", isNew: true },
  "exec-boardroom": { name: "Boardroom", category: "Executive", description: "Conservative boardroom style", isNew: true },
  "exec-classic": { name: "Classic Executive", category: "Executive", description: "Traditional executive format", isNew: true },
  "exec-two-page": { name: "Executive Two-Page", category: "Executive", description: "Extended two-page layout", isNew: true },
  "exec-minimal": { name: "Executive Minimal", category: "Executive", description: "Minimalist senior format", isNew: true },
  "exec-dark": { name: "Executive Dark", category: "Executive", description: "Dark header executive style", isNew: true },
  "exec-timeline": { name: "Executive Timeline", category: "Executive", description: "Career timeline for leaders", isNew: true },
  // Creative variants
  "creative-infographic": { name: "Infographic", category: "Creative", description: "Visual skill bars & icons", isNew: true },
  "creative-portfolio": { name: "Portfolio Style", category: "Creative", description: "Portfolio-inspired layout", isNew: true },
  "creative-sidebar": { name: "Creative Sidebar", category: "Creative", description: "Colorful sidebar design", isNew: true },
  "creative-bold-color": { name: "Bold Color", category: "Creative", description: "Bold color-block header", isNew: true },
  "creative-typographic": { name: "Typographic", category: "Creative", description: "Typography-focused layout", isNew: true },
  "creative-icon-row": { name: "Icon Row", category: "Creative", description: "Icon row for contact info", isNew: true },
  "creative-pastel": { name: "Pastel", category: "Creative", description: "Soft pastel color theme", isNew: true },
  "creative-dark-accent": { name: "Dark Accent", category: "Creative", description: "Dark with colored accents", isNew: true },
  // Minimal ATS variants
  "ats-one-col": { name: "ATS One-Col", category: "Minimal ATS", description: "Single column, max ATS score", isNew: true },
  "ats-two-col": { name: "ATS Two-Col", category: "Minimal ATS", description: "Two columns, still ATS-safe", isNew: true },
  "ats-clean-header": { name: "ATS Clean Header", category: "Minimal ATS", description: "Clean header, zero clutter", isNew: true },
  "ats-compact": { name: "ATS Compact", category: "Minimal ATS", description: "Compact ATS-safe format", isNew: true },
  "ats-serif": { name: "ATS Serif", category: "Minimal ATS", description: "Serif font, classic ATS", isNew: true },
  "ats-wide-margin": { name: "ATS Wide Margin", category: "Minimal ATS", description: "Wide margins, clean reading", isNew: true },
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
