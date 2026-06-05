// =============================================
// Resume Studio — Type Definitions
// =============================================

// ---------- Resume JSON Schema ----------

export interface PersonalInfo {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export interface ExperienceEntry {
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  location: string;
  bullets: string[];
}

export interface EducationEntry {
  institution: string;
  degree: string;
  field: string;
  year: string;
  gpa: string;
  location: string;
}

export interface SkillCategory {
  category: string;
  items: string[];
}

export interface ProjectEntry {
  name: string;
  description: string;
  link: string;
  tech: string[];
  bullets: string[];
}

export interface CertificationEntry {
  name: string;
  issuer: string;
  year: string;
  link: string;
}

export interface ExtrasSection {
  languages: string[];
  awards: string[];
  volunteer: string[];
}

export interface ResumeJSON {
  personal_info: PersonalInfo;
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: SkillCategory[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  extras: ExtrasSection;
}

// ---------- Studio Entities ----------

export interface StudioResume {
  id: string;
  user_id: string;
  original_pdf_url: string | null;
  parsed_json: ResumeJSON;
  current_json: ResumeJSON;
  title: string;
  template_id: StudioTemplateId;
  persona: PersonaId;
  created_at: string;
  updated_at: string;
}

export type PassType = 'free' | 'single' | 'weekly' | 'yearly';

export interface StudioSession {
  id: string;
  user_id: string;
  resume_id: string;
  pass_type: PassType;
  expires_at: string;
  messages_used: number;
  razorpay_payment_id: string | null;
  created_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface StudioMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  changes_applied: ResumeChange[] | null;
  model_used: string | null;
  tokens_used: number;
  created_at: string;
}

export interface StudioVersion {
  id: string;
  resume_id: string;
  snapshot_json: ResumeJSON;
  change_summary: string;
  triggered_by_message_id: string | null;
  created_at: string;
}

export type SuggestionType =
  | 'weak_bullet'
  | 'missing_section'
  | 'filler_words'
  | 'inconsistency'
  | 'passive_voice'
  | 'missing_metrics'
  | 'formatting'
  | 'keyword_gap';

export type SuggestionSeverity = 'low' | 'medium' | 'high';

export interface StudioSuggestion {
  id: string;
  resume_id: string;
  type: SuggestionType;
  target_path: string | null;
  suggestion: string;
  severity: SuggestionSeverity;
  applied: boolean;
  created_at: string;
}

// ---------- Chat Types ----------

export interface ResumeChange {
  path: string;
  old: string;
  new: string;
}

export interface AIResponse {
  explanation: string;
  changes: ResumeChange[];
  follow_up_suggestions?: string[];
}

export interface ChatStreamChunk {
  type: 'text' | 'changes' | 'done' | 'error';
  content?: string;
  changes?: ResumeChange[];
  message_id?: string;
  version_id?: string;
  error?: string;
}

// ---------- Persona Types ----------

export type PersonaId =
  | 'big-tech'
  | 'startup'
  | 'conservative'
  | 'ai-ml'
  | 'career-switcher';

export interface Persona {
  id: PersonaId;
  name: string;
  description: string;
  icon: string;
  instructions: string;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  'big-tech': {
    id: 'big-tech',
    name: 'Big Tech',
    description: 'Metrics-heavy, scale-focused, FAANG keywords',
    icon: '🏢',
    instructions: `Optimize for Big Tech roles (FAANG/MANGA). Use metrics-heavy language emphasizing scale (millions of users, petabytes, 99.99% uptime). Highlight system design, distributed systems, and cross-functional leadership. Use keywords: impact, scale, ownership, bar-raising, customer obsession. Prefer quantified results over responsibilities.`,
  },
  'startup': {
    id: 'startup',
    name: 'Startup',
    description: 'Ownership language, scrappy, results-oriented',
    icon: '🚀',
    instructions: `Optimize for startup roles. Use ownership language: "built from scratch", "wore multiple hats", "zero to one". Emphasize speed, resourcefulness, and direct business impact. Highlight revenue generation, user growth, and shipping velocity. Avoid corporate jargon. Show builder mentality and comfort with ambiguity.`,
  },
  'conservative': {
    id: 'conservative',
    name: 'Enterprise',
    description: 'Polished, formal, hierarchy-aware',
    icon: '🏛️',
    instructions: `Optimize for enterprise/consulting roles. Use formal, polished language. Emphasize process improvement, stakeholder management, and governance. Highlight certifications, compliance, and structured methodologies (Agile, Six Sigma, ITIL). Show career progression and organizational impact. Avoid informal tone.`,
  },
  'ai-ml': {
    id: 'ai-ml',
    name: 'AI/ML',
    description: 'Research-flavored, depth signals, paper citations',
    icon: '🧠',
    instructions: `Optimize for AI/ML engineering and research roles. Emphasize model architectures, training infrastructure, and benchmark improvements. Include publication-style language where appropriate. Highlight frameworks (PyTorch, TensorFlow, JAX), model serving, and MLOps. Quantify model performance gains (accuracy, latency, throughput). Show research-to-production pipeline experience.`,
  },
  'career-switcher': {
    id: 'career-switcher',
    name: 'Career Switcher',
    description: 'Transferable skills, narrative bridge',
    icon: '🔄',
    instructions: `Optimize for career transition. Bridge previous experience to target role using transferable skills. Reframe past accomplishments in terms relevant to the new field. Emphasize adaptability, learning velocity, and unique perspective. Highlight relevant side projects, certifications, and coursework. Create a narrative of intentional career evolution, not random change.`,
  },
};

// ---------- Template Types ----------

export type StudioTemplateId =
  | 'classic-ats'
  | 'modern-tech'
  | 'executive-pro'
  | 'minimal-clean'
  | 'impact-focused';

export interface StudioTemplate {
  id: StudioTemplateId;
  name: string;
  description: string;
  fontFamily: string;
  accentColor: string;
  preview: string; // CSS gradient for thumbnail
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: 'classic-ats',
    name: 'Classic ATS',
    description: 'Conservative, Times New Roman, single-column',
    fontFamily: 'Times New Roman, serif',
    accentColor: '#1a1a1a',
    preview: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)',
  },
  {
    id: 'modern-tech',
    name: 'Modern Tech',
    description: 'Inter, two-column, accent colors',
    fontFamily: 'Inter, sans-serif',
    accentColor: '#8B5CF6',
    preview: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
  },
  {
    id: 'executive-pro',
    name: 'Executive Pro',
    description: 'Serif headers, elegant spacing',
    fontFamily: 'Georgia, serif',
    accentColor: '#1e3a5f',
    preview: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
  },
  {
    id: 'minimal-clean',
    name: 'Minimal Clean',
    description: 'Helvetica, lots of whitespace',
    fontFamily: 'Helvetica, Arial, sans-serif',
    accentColor: '#374151',
    preview: 'linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)',
  },
  {
    id: 'impact-focused',
    name: 'Impact Focused',
    description: 'Bold metrics highlighted, achievement-first',
    fontFamily: 'Inter, sans-serif',
    accentColor: '#059669',
    preview: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
  },
];

// ---------- Quick Action Chips ----------

export interface QuickAction {
  label: string;
  prompt: string;
  icon: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Tailor for a specific job', prompt: 'Help me tailor my resume for a specific job posting. Ask me for the job description.', icon: '🎯' },
  { label: 'Add metrics to bullets', prompt: 'Review all my experience bullets and add specific metrics, numbers, and quantifiable achievements where possible.', icon: '📊' },
  { label: 'Rewrite for AI Engineer', prompt: 'Rewrite my resume targeting AI/ML Engineer roles, emphasizing relevant technical skills and projects.', icon: '🤖' },
  { label: 'Make it more aggressive', prompt: 'Make my resume more aggressive and impactful. Use stronger action verbs, bolder claims, and more confident language.', icon: '⚡' },
  { label: 'Fix weak bullets', prompt: 'Identify my weakest 3-5 bullets and rewrite them with stronger action verbs, metrics, and impact statements.', icon: '🔧' },
  { label: 'Optimize for ATS', prompt: 'Optimize my resume for ATS systems. Ensure proper formatting, keywords, and section headers that automated parsers can read.', icon: '🤖' },
  { label: 'Strengthen summary', prompt: 'Rewrite my professional summary to be more compelling, specific, and tailored to my experience level.', icon: '✍️' },
  { label: 'Add missing sections', prompt: 'Analyze my resume and suggest any missing sections or content that would strengthen my application.', icon: '➕' },
];

// ---------- Payment Types ----------

export interface StudioPlan {
  id: 'single' | 'weekly' | 'yearly';
  name: string;
  price: number; // in INR
  priceInPaise: number;
  duration: string;
  model: string;
  modelDisplay: string;
  badge?: string;
  paymentType: string;
}

export const STUDIO_PLANS: StudioPlan[] = [
  {
    id: 'single',
    name: 'Studio Pass',
    price: 149,
    priceInPaise: 14900,
    duration: '24 hours',
    model: 'claude-haiku-4-5-20251001',
    modelDisplay: 'Claude Haiku 4.5',
    paymentType: 'STUDIO_SINGLE',
  },
  {
    id: 'weekly',
    name: 'Pro Pass',
    price: 599,
    priceInPaise: 59900,
    duration: '7 days',
    model: 'claude-sonnet-4-6',
    modelDisplay: 'Claude Sonnet 4.6',
    badge: 'RECOMMENDED',
    paymentType: 'STUDIO_WEEKLY',
  },
  {
    id: 'yearly',
    name: 'Unlimited',
    price: 2499,
    priceInPaise: 249900,
    duration: '1 year',
    model: 'claude-sonnet-4-6',
    modelDisplay: 'Claude Sonnet 4.6',
    badge: 'BEST VALUE',
    paymentType: 'STUDIO_YEARLY',
  },
];

export const FREE_MESSAGE_LIMIT = 3;
