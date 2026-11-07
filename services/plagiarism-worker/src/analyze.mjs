// One similarity run with Dolos (https://dolos.ugent.be, MIT): tree-sitter tokens, winnowed k-gram fingerprints.
// The question's starter code is passed as Dolos's "ignored file", so shared boilerplate doesn't count as copying.
import { Dolos } from "@dodona/dolos-lib";
import { File } from "@dodona/dolos-core";
import { filesFor, pairsFromReport } from "./pairs.mjs";

const num = (v) => (v == null || v === "" ? undefined : Number(v));

/** Dolos options; defaults are Dolos's own (k-gram 23, window 17), overridable for tuning. */
export function dolosOptions(language, env = process.env) {
  return {
    language,
    kgramLength: num(env.DOLOS_KGRAM_LENGTH),
    kgramsInWindow: num(env.DOLOS_KGRAMS_IN_WINDOW),
  };
}

/** @param {{ language: string, starter_code: string | null, submissions: { attempt_id: string, code: string }[] }} job */
export async function analyze(job, env = process.env) {
  if (job.submissions.length < 2) return [];
  const { files, attemptByPath, starterPath } = filesFor(job.submissions, job.language);
  const dolos = new Dolos(dolosOptions(job.language, env));
  const starter = job.starter_code && job.starter_code.trim() ? new File(starterPath, job.starter_code) : undefined;
  const report = await dolos.analyze(files.map((f) => new File(f.path, f.content)), "run", starter);
  return pairsFromReport(report, attemptByPath);
}
