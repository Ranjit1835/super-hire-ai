// R2.2 parameterised MCQ templates. One template ("A train covers {{d}} km in {{t}} hours…") makes many concrete
// MCQs ahead of time, so papers differ without any model at exam time. Pure TypeScript, shared by the bank (live
// preview) and b2b-assess (the server generates and saves the variants; the server's numbers are the ones used).
//
// Formulas are parsed here (no eval): numbers, parameter names, + - * / % ^, comparisons, && ||, parentheses and
// round(x, d) floor ceil abs min max sqrt gcd lcm.

export interface TemplateParam { name: string; min?: number; max?: number; step?: number; choices?: number[] }
export interface McqTemplate {
  title: string;
  /** Text with {{name}} for a parameter and {{= formula}} for a computed value. */
  statement: string;
  params: TemplateParam[];
  /** Formula for the correct option. */
  answer: string;
  /** Formulas for the wrong options (at least 3); they must differ from the answer and each other. */
  distractors: string[];
  /** Decimal places for computed values (0 = whole numbers). */
  decimals: number;
  /** Shown after each option, e.g. "km/h". */
  unit?: string;
  /** Formulas that must be true for a combination to be used, e.g. "d % t == 0" for whole-number answers. */
  constraints?: string[];
}
export interface McqVariant {
  statement: string;
  options: { id: string; text: string }[];
  answer: string[];
  params: Record<string, number>;
}

// ── Formula parser ───────────────────────────────────────────────────────────
type Node =
  | { k: "num"; v: number } | { k: "var"; name: string } | { k: "neg"; a: Node } | { k: "not"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node } | { k: "call"; fn: string; args: Node[] };

const FUNCS: Record<string, (...x: number[]) => number> = {
  round: (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; },
  floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
  min: (...x) => Math.min(...x), max: (...x) => Math.max(...x),
  gcd: (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; },
  lcm: (a, b) => { const g = FUNCS.gcd(a, b); return g ? Math.abs(Math.round(a) * Math.round(b)) / g : 0; },
};

export class FormulaError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[-+*/%^(),<>!])/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaError(`Can't read "${src.slice(i, i + 10)}" in "${src}"`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

const BIN: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 8 };

export function parseFormula(src: string): Node {
  if (src.length > 500) throw new FormulaError("Formula is too long");
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const take = (x?: string) => {
    const v = t[p++];
    if (x !== undefined && v !== x) throw new FormulaError(`Expected "${x}" in "${src}"`);
    if (v === undefined) throw new FormulaError(`"${src}" ends too early`);
    return v;
  };
  const primary = (): Node => {
    const v = take();
    if (v === "(") { const e = expr(0); take(")"); return e; }
    if (v === "-") return { k: "neg", a: expr(7) };
    if (v === "!") return { k: "not", a: expr(7) };
    if (/^\d/.test(v)) return { k: "num", v: Number(v) };
    if (/^[A-Za-z_]/.test(v)) {
      if (peek() === "(") {
        if (!FUNCS[v]) throw new FormulaError(`Unknown function "${v}"`);
        take("(");
        const args: Node[] = [];
        if (peek() !== ")") { args.push(expr(0)); while (peek() === ",") { take(","); args.push(expr(0)); } }
        take(")");
        return { k: "call", fn: v, args };
      }
      return { k: "var", name: v };
    }
    throw new FormulaError(`Unexpected "${v}" in "${src}"`);
  };
  const expr = (minPrec: number): Node => {
    let left = primary();
    for (;;) {
      const op = peek();
      const prec = op === undefined ? undefined : BIN[op];
      if (prec === undefined || prec < minPrec) return left;
      take();
      const right = expr(op === "^" ? prec : prec + 1);   // ^ is right-associative
      left = { k: "bin", op, a: left, b: right };
    }
  };
  const tree = expr(0);
  if (p < t.length) throw new FormulaError(`Unexpected "${t[p]}" in "${src}"`);
  return tree;
}

export function evalFormula(n: Node, vars: Record<string, number>): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": {
      if (!(n.name in vars)) throw new FormulaError(`Unknown name "${n.name}"`);
      return vars[n.name];
    }
    case "neg": return -evalFormula(n.a, vars);
    case "not": return evalFormula(n.a, vars) ? 0 : 1;
    case "call": return FUNCS[n.fn](...n.args.map((a) => evalFormula(a, vars)));
    case "bin": {
      const a = evalFormula(n.a, vars), b = evalFormula(n.b, vars);
      switch (n.op) {
        case "+": return a + b; case "-": return a - b; case "*": return a * b;
        case "/": return b === 0 ? NaN : a / b; case "%": return b === 0 ? NaN : a % b; case "^": return a ** b;
        case "==": return Math.abs(a - b) < 1e-9 ? 1 : 0; case "!=": return Math.abs(a - b) < 1e-9 ? 0 : 1;
        case "<": return a < b ? 1 : 0; case "<=": return a <= b ? 1 : 0; case ">": return a > b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
        case "&&": return a && b ? 1 : 0; case "||": return a || b ? 1 : 0;
      }
    }
  }
  throw new FormulaError("Bad formula");
}

/** Names a formula uses. */
function namesIn(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "var") out.add(n.name);
  else if (n.k === "neg" || n.k === "not") namesIn(n.a, out);
  else if (n.k === "bin") { namesIn(n.a, out); namesIn(n.b, out); }
  else if (n.k === "call") n.args.forEach((a) => namesIn(a, out));
  return out;
}

// ── Template checks ──────────────────────────────────────────────────────────
const PLACEHOLDER = /\{\{\s*(=)?\s*([^}]+?)\s*\}\}/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;
export const MAX_VARIANTS = 50;

function values(p: TemplateParam): number[] {
  if (p.choices?.length) return p.choices.slice(0, 1000);
  const step = p.step && p.step > 0 ? p.step : 1;
  const out: number[] = [];
  for (let v = p.min ?? 0; v <= (p.max ?? 0) + 1e-9 && out.length < 10_000; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Problems that stop a template from being used, in words for the editor. Empty when it's fine. */
export function templateErrors(t: McqTemplate): string[] {
  const errs: string[] = [];
  const names = new Set<string>();
  if (!t.params.length) errs.push("Add at least one parameter.");
  for (const p of t.params) {
    if (!NAME.test(p.name)) errs.push(`"${p.name}" isn't a valid name (letters, digits and _; starts with a letter).`);
    else if (names.has(p.name)) errs.push(`"${p.name}" is used twice.`);
    else if (FUNCS[p.name]) errs.push(`"${p.name}" is a function name; pick another.`);
    names.add(p.name);
    if (!p.choices?.length && (p.min === undefined || p.max === undefined || p.min > p.max)) errs.push(`"${p.name}" needs a range (min ≤ max) or a list of values.`);
  }
  if (t.distractors.length < 3) errs.push("Add at least 3 wrong-option formulas.");
  if (t.decimals < 0 || t.decimals > 4 || !Number.isInteger(t.decimals)) errs.push("Decimal places: 0 to 4.");
  const formulas: [string, string][] = [["Answer", t.answer], ...t.distractors.map((d, i) => [`Wrong option ${i + 1}`, d] as [string, string]),
    ...(t.constraints ?? []).map((c, i) => [`Condition ${i + 1}`, c] as [string, string])];
  for (const m of t.statement.matchAll(PLACEHOLDER)) formulas.push(["Question text", m[2]]);
  for (const [label, f] of formulas) {
    try {
      for (const n of namesIn(parseFormula(f))) if (!names.has(n)) errs.push(`${label}: "${n}" isn't a parameter.`);
    } catch (e) {
      errs.push(`${label}: ${e instanceof Error ? e.message : "can't read the formula"}`);
    }
  }
  if (!PLACEHOLDER.test(t.statement)) errs.push("The question text doesn't use any parameter ({{name}}).");
  PLACEHOLDER.lastIndex = 0;
  return errs;
}

// ── Variant generation ───────────────────────────────────────────────────────
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {   // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (v: number, decimals: number) => {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return decimals === 0 ? String(r) : r.toFixed(decimals).replace(/\.?0+$/, "");
};
const OPTION_IDS = ["a", "b", "c", "d", "e", "f"];

/**
 * Up to `count` distinct variants (different parameter values), deterministic for a seed. Combinations whose answer
 * isn't a finite number, that break a condition, or whose options collide are skipped.
 */
export function generateVariants(t: McqTemplate, count: number, seed: string): { variants: McqVariant[]; tried: number; skipped: number } {
  const errs = templateErrors(t);
  if (errs.length) throw new FormulaError(errs[0]);
  const rand = seededRandom(seed);
  const answer = parseFormula(t.answer);
  const wrong = t.distractors.slice(0, OPTION_IDS.length - 1).map(parseFormula);
  const conds = (t.constraints ?? []).map(parseFormula);
  const pools = t.params.map(values);
  const seen = new Set<string>();
  const variants: McqVariant[] = [];
  const want = Math.min(Math.max(1, Math.floor(count)), MAX_VARIANTS);
  let tried = 0, skipped = 0;
  while (variants.length < want && tried < want * 200) {
    tried++;
    const vars: Record<string, number> = {};
    t.params.forEach((p, i) => { vars[p.name] = pools[i][Math.floor(rand() * pools[i].length)]; });
    const key = JSON.stringify(vars);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (conds.some((c) => !evalFormula(c, vars))) { skipped++; continue; }
      const right = fmt(evalFormula(answer, vars), t.decimals);
      const others = wrong.map((w) => fmt(evalFormula(w, vars), t.decimals));
      const all = [right, ...others];
      if (all.some((x) => !Number.isFinite(Number(x))) || new Set(all).size !== all.length) { skipped++; continue; }
      // place the right answer at a random position
      const order = all.map((text, i) => ({ text, right: i === 0, k: rand() })).sort((x, y) => x.k - y.k);
      const unit = t.unit?.trim() ? ` ${t.unit.trim()}` : "";
      const options = order.map((o, i) => ({ id: OPTION_IDS[i], text: `${o.text}${unit}` }));
      const statement = t.statement.replace(PLACEHOLDER, (_m, eq: string | undefined, body: string) =>
        eq ? fmt(evalFormula(parseFormula(body), vars), t.decimals) : (body in vars ? fmt(vars[body], 6) : fmt(evalFormula(parseFormula(body), vars), t.decimals)));
      variants.push({ statement, options, answer: [OPTION_IDS[order.findIndex((o) => o.right)]], params: vars });
    } catch {
      skipped++;
    }
  }
  return { variants, tried, skipped };
}
