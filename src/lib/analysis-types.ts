export interface AnalysisIssue {
  issue: string;
  impactLevel: "HIGH" | "MEDIUM" | "LOW";
  whyItMatters: string;
  fixRecommendation: string;
}

export interface AnalysisResult {
  atsScore: number;
  recruiterScanScore: number;
  keywordStrengthScore: number;
  quantificationScore: number;
  structureScore: number;
  interviewProbability: number;
  marketCompetitivenessLevel: "Below Average" | "Competitive" | "Strong" | "Elite";
  performanceLevelTag: string;
  contextStatement: string;
  criticalIssues: AnalysisIssue[];
  warnings: AnalysisIssue[];
  optimizationOpportunities: AnalysisIssue[];
  advancedRefinements: AnalysisIssue[];
  rewrittenSummary: string;
  rewrittenStrongBullets: string[];
  missingHighImpactKeywords: string[];
  keywordEnrichmentSuggestions: string[];
  recruiterPsychologyInsight: string;
  finalVerdict: string;
  resumeType?: "STUDENT" | "PROFESSIONAL";
  studentGrowthRecommendations?: string[];
  resumeRoast?: string;
  roastFixTips?: string[];
}
