#!/usr/bin/env node
// Quality baseline: the existing ESLint errors and TypeScript errors (tsconfig.app.json) are recorded
// per file and rule/code in quality-baseline.json. `check` fails only when a count goes UP (new
// errors); fixing old ones is always allowed (run `update` to lock in the improvement).
//   node scripts/quality-baseline.mjs check | update
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ESLint } from "eslint";

const ROOT = resolve(import.meta.dirname, "..");
const FILE = resolve(ROOT, "quality-baseline.json");
const rel = (p) => relative(ROOT, p).split("\\").join("/");

async function eslintCounts() {
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(["."]);
  const counts = {};
  for (const r of results) {
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      const k = `${rel(r.filePath)}::${m.ruleId ?? "parse"}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

function tscCounts() {
  let out = "";
  try {
    out = execFileSync(process.execPath, [resolve(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const counts = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+):/);
    if (!m) continue;
    const k = `${m[1].split("\\").join("/")}::${m[2]}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

async function main() {
  const mode = process.argv[2] ?? "check";
  const current = { eslint: await eslintCounts(), tsc: tscCounts() };
  if (mode === "update") {
    writeFileSync(FILE, JSON.stringify(current, null, 2) + "\n");
    console.log(`Baseline written: ${sum(current.eslint)} ESLint errors, ${sum(current.tsc)} TypeScript errors.`);
    return;
  }
  if (!existsSync(FILE)) { console.error("No quality-baseline.json; run with `update` first."); process.exit(2); }
  const base = JSON.parse(readFileSync(FILE, "utf8"));
  const worse = [];
  for (const kind of ["eslint", "tsc"]) {
    for (const [k, n] of Object.entries(current[kind])) {
      const was = base[kind]?.[k] ?? 0;
      if (n > was) worse.push(`${kind}: ${k} ${was} → ${n}`);
    }
  }
  console.log(`ESLint errors: ${sum(current.eslint)} (baseline ${sum(base.eslint)}). TypeScript errors: ${sum(current.tsc)} (baseline ${sum(base.tsc)}).`);
  if (worse.length) {
    console.error(`New errors:\n  ${worse.join("\n  ")}`);
    process.exit(1);
  }
  console.log("No new lint or type errors.");
}

main().catch((e) => { console.error(e); process.exit(2); });
