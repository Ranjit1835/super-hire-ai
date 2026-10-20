// Per-feature model routing. Gemini is the default for every feature (Decisions log 2026-10-20); any
// feature can be moved to another provider/model by config alone. Override at deploy time with the
// B2B_AI_CONFIG secret: JSON of { "<feature>": { ...partial FeatureConfig } }.
import type { FeatureConfig } from "./core.ts";

const FAST = "gemini-3.6-flash";

// cache: "org" whenever personal data is in the input; "none" for live interview turns and for the
// evaluation of a specific interview or attempt (never cached).
export const FEATURES: Record<string, FeatureConfig> = {
  "jd.skills_matrix":     { provider: "gemini", model: FAST, promptVersion: "jd-skills-v1", cache: "org", ttlSeconds: 30 * 86400, maxTokens: 6000, temperature: 0.2, reasoningEffort: "low", timeoutMs: 45_000, quotaKey: "jd.skills_matrix" },
  "question.generate":    { provider: "gemini", model: FAST, promptVersion: "qgen-v1", cache: "global", ttlSeconds: null, maxTokens: 16000, temperature: 0.7, reasoningEffort: "medium", timeoutMs: 90_000, quotaKey: "question.generate" },
  "mcq.explain":          { provider: "gemini", model: FAST, promptVersion: "mcq-explain-v1", cache: "global", ttlSeconds: null, maxTokens: 2000, temperature: 0.2, reasoningEffort: "low", timeoutMs: 30_000 },
  "code.quality_review":  { provider: "gemini", model: FAST, promptVersion: "code-review-v1", cache: "none", ttlSeconds: null, maxTokens: 4000, temperature: 0.2, reasoningEffort: "low", timeoutMs: 45_000 },
  "resume.screen":        { provider: "gemini", model: FAST, promptVersion: "resume-screen-v1", cache: "org", ttlSeconds: 30 * 86400, maxTokens: 6000, temperature: 0.2, reasoningEffort: "low", timeoutMs: 45_000, quotaKey: "resume.screen" },
  "resume.analyze":       { provider: "gemini", model: FAST, promptVersion: "resume-analyze-v1", cache: "org", ttlSeconds: 30 * 86400, maxTokens: 12000, temperature: 0.2, reasoningEffort: "low", timeoutMs: 60_000, quotaKey: "resume.analyze" },
  "proctor.frame_label":  { provider: "gemini", model: FAST, promptVersion: "frame-label-v1", cache: "none", ttlSeconds: null, maxTokens: 800, temperature: 0, reasoningEffort: "low", timeoutMs: 20_000 },
  "interview.turn":       { provider: "gemini", model: FAST, promptVersion: "interview-turn-v1", cache: "none", ttlSeconds: null, maxTokens: 4096, temperature: 0.4, reasoningEffort: "low", timeoutMs: 25_000 },
  "interview.evaluate":   { provider: "gemini", model: FAST, promptVersion: "evaluator-2026-09-v1", cache: "none", ttlSeconds: null, maxTokens: 12000, temperature: 0.2, reasoningEffort: "medium", timeoutMs: 60_000 },
};

export function makeConfig(overridesJson: string | undefined): (feature: string) => FeatureConfig {
  let overrides: Record<string, Partial<FeatureConfig>> = {};
  if (overridesJson) {
    try { overrides = JSON.parse(overridesJson); } catch { console.error("[ai-gateway] B2B_AI_CONFIG is not valid JSON; ignored"); }
  }
  return (feature: string) => {
    const base = FEATURES[feature];
    if (!base) throw new Error(`Unknown AI feature: ${feature}`);
    return { ...base, ...(overrides[feature] ?? {}) };
  };
}
