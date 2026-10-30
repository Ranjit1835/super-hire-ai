#!/usr/bin/env node
// R3.1 pricing secrecy check. Prices live in the database and reach only super-admin screens; nothing a TPO, org
// admin, student or candidate loads may carry a price.
//  1. Source: B2B code outside super-admin files has no price fields or ₹ amounts (type declarations excepted).
//  2. Bundle (after `vite build`): only super-admin chunks contain price fields. Run with --bundle.
// Exit code 1 lists every offending file. Usage: node scripts/check-b2b-price-secrecy.mjs [--bundle]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const PRICE = /price_inr|pricePerStudent|₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d/;
/** Super-admin code may show prices; type declarations don't ship. */
const SOURCE_ALLOW = [/^src\/b2b\/admin\//, /^src\/features\/b2b\/pages\/SuperAdmin/, /^src\/b2b\/gallery\//, /\/types\.ts$/, /\.test\.tsx?$/];
/** Chunks Vite names after super-admin pages. */
const CHUNK_ALLOW = [/^(AdminOrgsPage|AdminUsagePage|SuperAdminCosts|SuperAdminOrgs|SuperAdminEnquiries|CreateOrgDialog|OrgActions)-/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function sourceViolations(root = ROOT) {
  const bad = [];
  for (const base of ["src/b2b", "src/features/b2b"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) {
      const rel = relative(root, f).split(sep).join("/");
      if (!/\.(ts|tsx)$/.test(rel) || SOURCE_ALLOW.some((r) => r.test(rel))) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => { if (PRICE.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`); });
    }
  }
  return bad;
}

export function bundleViolations(root = ROOT) {
  const dir = join(root, "dist", "assets");
  if (!existsSync(dir)) throw new Error("dist/assets not found: run `vite build` first");
  const bad = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js") || CHUNK_ALLOW.some((r) => r.test(name))) continue;
    if (/price_inr/.test(readFileSync(join(dir, name), "utf8"))) bad.push(`dist/assets/${name}: contains price_inr`);
  }
  return bad;
}

if (process.argv[1] && process.argv[1].endsWith("check-b2b-price-secrecy.mjs")) {
  const bad = [...sourceViolations(), ...(process.argv.includes("--bundle") ? bundleViolations() : [])];
  if (bad.length) {
    console.error("R3.1 pricing secrecy: prices found outside super-admin code:\n" + bad.map((b) => `  ${b}`).join("\n"));
    process.exit(1);
  }
  console.log(`R3.1 pricing secrecy: ok${process.argv.includes("--bundle") ? " (source and bundle)" : " (source)"}`);
}
