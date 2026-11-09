// Turns a Dolos report into the rows b2b_similarity_complete stores. No Dolos import here, so this is testable
// anywhere; the report only needs the shape documented below (dolos-lib 3.x Report / dolos-core Pair).

/** Pairs below this similarity aren't sent (the database applies the same floor). */
export const FLOOR = 0.3;
/** At most this many pairs per run, most similar first. */
export const MAX_PAIRS = 5000;
/** At most this many matched regions per pair. */
export const MAX_FRAGMENTS = 50;

const region = (r) => [r.startRow, r.startCol, r.endRow, r.endCol];

/**
 * @param {{ allPairs(): Array<{ leftFile: { path: string }, rightFile: { path: string }, similarity: number,
 *   longest: number, overlap: number, buildFragments(): Array<{ leftSelection: object, rightSelection: object }> }> }} report
 * @param {Map<string, string>} attemptByPath  file path given to Dolos -> attempt id
 */
export function pairsFromReport(report, attemptByPath, { floor = FLOOR, max = MAX_PAIRS } = {}) {
  const out = [];
  for (const p of report.allPairs()) {
    if (!(p.similarity >= floor)) continue;
    const a = attemptByPath.get(p.leftFile.path);
    const b = attemptByPath.get(p.rightFile.path);
    if (!a || !b || a === b) continue;   // e.g. the ignored starter file
    out.push({ p, a, b });
  }
  out.sort((x, y) => y.p.similarity - x.p.similarity);
  return out.slice(0, max).map(({ p, a, b }) => ({
    attempt_a: a,
    attempt_b: b,
    similarity: Math.round(p.similarity * 10_000) / 10_000,
    longest: p.longest,
    overlap: p.overlap,
    fragments: p.buildFragments().slice(0, MAX_FRAGMENTS).map((f) => ({ a: region(f.leftSelection), b: region(f.rightSelection) })),
  }));
}

export const EXTENSION = { python: "py", java: "java", c: "c", cpp: "cpp", javascript: "js" };

/** File paths for the submissions; the path is how pairs map back to attempts. */
export function filesFor(submissions, language) {
  const ext = EXTENSION[language];
  if (!ext) throw new Error(`unsupported language: ${language}`);
  const attemptByPath = new Map();
  const files = submissions.map((s, i) => {
    const path = `s${i}.${ext}`;
    attemptByPath.set(path, s.attempt_id);
    return { path, content: s.code };
  });
  return { files, attemptByPath, starterPath: `starter.${ext}` };
}
