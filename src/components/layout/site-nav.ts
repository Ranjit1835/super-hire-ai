// Every link in the site header and footer, in one place. src/components/layout/links.test.ts
// checks each one (and every other internal link in the code) resolves to a real route.
import {
  BarChart3, Building2, FileText, Headphones, Mic, Sparkles, Trophy, Wrench, type LucideIcon,
} from "lucide-react";

export interface NavLinkItem {
  href: string;
  label: string;
  /** Other paths that should highlight this item (e.g. the voice interview under "Interview"). */
  alsoActive?: string[];
}

/** Header links for visitors who aren't signed in. */
export const PUBLIC_NAV: NavLinkItem[] = [
  { href: "/ats-checker", label: "ATS Checker" },
  { href: "/build-resume", label: "Resume Builder" },
  { href: "/mock-interview", label: "Mock Interview", alsoActive: ["/voice-interview"] },
  { href: "/college-placement", label: "For Colleges" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

/** Header links once signed in. */
export const APP_NAV: NavLinkItem[] = [
  { href: "/dashboard", label: "Dashboard", alsoActive: ["/analysis/", "/fix/"] },
  { href: "/studio", label: "Studio" },
  { href: "/build-resume", label: "Builder" },
  { href: "/mock-interview", label: "Interview", alsoActive: ["/voice-interview"] },
];

/** Secondary links in the signed-in account menu. */
export const ACCOUNT_NAV: NavLinkItem[] = [
  { href: "/pricing", label: "Plans & pricing" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export const FOOTER_COLUMNS: { title: string; links: NavLinkItem[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/ats-checker", label: "ATS Score Checker" },
      { href: "/build-resume", label: "Resume Builder" },
      { href: "/studio", label: "Resume Studio" },
      { href: "/mock-interview", label: "Mock Interview" },
      { href: "/voice-interview", label: "Voice Interview" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/blog/ats-friendly-resume-format", label: "ATS resume format" },
      { href: "/blog/fresher-resume-guide", label: "Resume for freshers" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/college-placement", label: "For Colleges" },
    ],
  },
];

export interface Feature {
  href: string;
  title: string;
  desc: string;
  cta: string;
  icon: LucideIcon;
  /** Needs an account (signed-out visitors go to sign-in first, then straight here). */
  signIn?: boolean;
}

/** One entry per product feature, shown on the home page. */
export const FEATURES: Feature[] = [
  { href: "/ats-checker", icon: BarChart3, title: "ATS score check", cta: "Check my resume",
    desc: "Upload a PDF and see what applicant tracking systems read, the keywords you're missing and what to fix. Free, no sign-up." },
  { href: "/ats-checker", icon: Wrench, title: "AI resume fix", cta: "Start with a free check",
    desc: "After your score, one click rewrites your resume for the job, keeping your facts. Download it as an ATS-friendly PDF." },
  { href: "/build-resume", icon: FileText, title: "Resume builder", cta: "Build a resume", signIn: true,
    desc: "No resume yet? Fill in your details step by step and pick from 15 templates, including one-column ATS layouts." },
  { href: "/studio", icon: Sparkles, title: "Resume Studio", cta: "Open Studio", signIn: true,
    desc: "Edit your resume by chatting with AI: tailor it to a job description, tighten bullets and see changes live." },
  { href: "/mock-interview", icon: Mic, title: "Mock interview", cta: "Practise now", signIn: true,
    desc: "Answer role-specific questions by typing or speaking, then get a scored report on what to improve." },
  { href: "/voice-interview", icon: Headphones, title: "Voice interview", cta: "Start talking", signIn: true,
    desc: "A spoken interview: the AI interviewer asks questions out loud and listens to your answers, like the real thing." },
  { href: "/leaderboard", icon: Trophy, title: "Leaderboard", cta: "See the leaderboard",
    desc: "Opt in to share your ATS score and see how it compares with others on HiResume." },
  { href: "/college-placement", icon: Building2, title: "For colleges", cta: "For placement offices",
    desc: "Placement offices can invite students, run practice interviews at scale and track readiness on one dashboard." },
];
