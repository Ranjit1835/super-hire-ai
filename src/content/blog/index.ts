import type { Article } from "./types";
import { whatIsAtsResume } from "./what-is-ats-resume";
import { atsFriendlyResumeFormat } from "./ats-friendly-resume-format";
import { resumeKeywordsOptimization } from "./resume-keywords-optimization";
import { fresherResumeGuide } from "./fresher-resume-guide";
import { aiMockInterviewGuide } from "./ai-mock-interview-guide";
import { resumeMistakes } from "./resume-mistakes-getting-rejected";
import { resumeActionVerbs } from "./resume-action-verbs";
import { quantifyResumeAchievements } from "./quantify-resume-achievements";

export type { Article, Block } from "./types";

/** Newest / most important first — this is the order on /blog. */
export const ARTICLES: Article[] = [
  whatIsAtsResume,
  fresherResumeGuide,
  atsFriendlyResumeFormat,
  resumeKeywordsOptimization,
  aiMockInterviewGuide,
  resumeMistakes,
  resumeActionVerbs,
  quantifyResumeAchievements,
];

export const articleBySlug = (slug: string) => ARTICLES.find((a) => a.slug === slug);
