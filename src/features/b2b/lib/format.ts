/** "Sri Venkateswara College of Engg." -> "sri-venkateswara-college-of-engg" (matches the DB slug CHECK). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const DB_ERRORS: Array<[RegExp, string]> = [
  [/STUDENT_LIMIT_REACHED: plan allows (\d+) students/, "This plan allows $1 students. Upgrade the plan or remove inactive students."],
  [/USER_NOT_FOUND/, "No HiResume account uses that email yet. Ask them to sign up first."],
  [/FORBIDDEN|row-level security|permission denied/, "You don't have permission to do that."],
  [/organizations_slug_key|duplicate key.*slug/, "That link name is already taken. Choose another."],
  [/organizations_slug_check/, "Link name must be 3–50 lowercase letters, numbers or hyphens."],
  [/organizations_plan_window/, "Plan end date must be after the start date."],
];

/** Turn a Postgres/PostgREST error into something an admin can act on. */
export function friendlyDbError(err: unknown): string {
  const msg = typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  for (const [re, text] of DB_ERRORS) {
    const m = msg.match(re);
    if (m) return text.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
  }
  return msg || "Something went wrong.";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function daysLeft(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}
