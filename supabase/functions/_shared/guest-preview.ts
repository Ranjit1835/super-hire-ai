// What a visitor sees before signing in: one real problem from their resume and a few of the
// keywords it's missing, so the free account has something behind it. The fix for that problem
// and everything else in the report stay behind the sign-in.

interface PreviewIssue {
  issue?: string;
  whyItMatters?: string;
}

interface PreviewSource {
  criticalIssues?: PreviewIssue[];
  warnings?: PreviewIssue[];
  optimizationOpportunities?: PreviewIssue[];
  missingHighImpactKeywords?: string[];
}

const KEYWORDS_SHOWN = 3;

export function guestPreview(result: PreviewSource | null | undefined) {
  const top = result?.criticalIssues?.[0] ?? result?.warnings?.[0] ?? result?.optimizationOpportunities?.[0];
  const keywords = Array.isArray(result?.missingHighImpactKeywords) ? result.missingHighImpactKeywords : [];
  return {
    topIssue: top?.issue ? { issue: top.issue, whyItMatters: top.whyItMatters ?? "" } : null,
    missingKeywords: keywords.slice(0, KEYWORDS_SHOWN),
    missingKeywordsCount: keywords.length,
  };
}
