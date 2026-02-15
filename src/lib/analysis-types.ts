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
  criticalIssues: AnalysisIssue[];
  warnings: AnalysisIssue[];
  optimizationOpportunities: AnalysisIssue[];
  advancedRefinements: AnalysisIssue[];
  rewrittenSummary: string;
  rewrittenStrongBullets: string[];
  missingHighImpactKeywords: string[];
  recruiterPsychologyInsight: string;
  finalVerdict: string;
}
