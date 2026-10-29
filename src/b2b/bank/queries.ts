import { useQuery } from "@tanstack/react-query";
import { b2bDb } from "@/features/b2b/lib/db";
import type { AssessmentRow, QuestionRow } from "./forms";

async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** "global" in the URL = the global bank (super admin). */
export const orgOf = (param: string | undefined): string | null => (!param || param === "global" ? null : param);

export function useCanEdit(orgId: string | null) {
  return useQuery({
    queryKey: ["b2b-assess", "can-edit", orgId],
    staleTime: 60_000,
    queryFn: async () => (orgId === null
      ? rows<boolean>(b2bDb.rpc("is_super_admin"))
      : (await rows<boolean>(b2bDb.rpc("is_org_editor", { _org_id: orgId }))) || rows<boolean>(b2bDb.rpc("is_super_admin"))),
  });
}

const QUESTION_COLS = "id, org_id, type, title, statement, difficulty, topics, category, languages, starter_code, constraints, time_limit_ms, memory_limit_kb, options, answer, multi_select, explanation, points, status, source, version, created_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BankType = "all" | "coding" | "mcq";
export type BankOwner = "all" | "ours" | "global";
export interface BankQuery { type: BankType; owner: BankOwner; search: string; page: number }
export interface BankCounts { verified: number; draft: number; retired: number; coding: number; mcq: number }
export interface BankPageResult { total: number; rows: QuestionRow[]; counts: BankCounts }
export const BANK_PAGE = 50;

/**
 * One page of the bank, filtered and counted in the database (b2b_bank_page; RLS decides what's visible). Counts
 * describe the whole bank in scope, not the page or the search. All bank keys start ["b2b-assess", "bank", orgId] so
 * one invalidation refreshes the page, the counts and the builder's pool.
 */
export function useBankPage(orgId: string | null, q: BankQuery, enabled = true) {
  return useQuery({
    queryKey: ["b2b-assess", "bank", orgId, "page", q],
    enabled: enabled && (orgId === null || UUID.test(orgId)),
    placeholderData: (prev) => prev,
    queryFn: () => rows<BankPageResult>(b2bDb.rpc("b2b_bank_page", {
      _org_id: orgId, _owner: q.owner, _type: q.type, _search: q.search.trim(), _page: q.page, _page_size: BANK_PAGE,
    })),
  });
}

/** What the test builder needs to reason about draws: every verified question, light columns only. */
export type PoolRow = Pick<QuestionRow, "id" | "org_id" | "type" | "title" | "difficulty" | "topics" | "languages" | "status">;
const POOL_COLS = "id, org_id, type, title, difficulty, topics, languages, status";
const POOL_CHUNK = 1000;   // PostgREST's max_rows; read in chunks until a short one, so there is no cap

export function useVerifiedPool(orgId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["b2b-assess", "bank", orgId, "pool"],
    enabled: enabled && (orgId === null || UUID.test(orgId)),
    queryFn: async () => {
      const out: PoolRow[] = [];
      for (let from = 0; ; from += POOL_CHUNK) {
        const base = b2bDb.from("questions").select(POOL_COLS).eq("status", "verified");
        const scoped = orgId === null ? base.is("org_id", null) : base.or(`org_id.eq.${orgId},org_id.is.null`);
        const chunk = await rows<PoolRow[]>(scoped.order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(from, from + POOL_CHUNK - 1));
        out.push(...chunk);
        if (chunk.length < POOL_CHUNK) return out;
      }
    },
  });
}

export async function loadCodingDetails(questionId: string) {
  const [tests, refs] = await Promise.all([
    rows<{ input: string; expected_output: string; is_sample: boolean; weight: number }[]>(
      b2bDb.from("test_cases").select("input, expected_output, is_sample, weight").eq("question_id", questionId).order("ordinal")),
    rows<{ language: string; code: string }[]>(b2bDb.from("reference_solutions").select("language, code").eq("question_id", questionId).limit(1)),
  ]);
  return { tests, reference: refs[0] ?? null };
}

const REASONS: Record<string, string> = {
  NEED_TESTS: "Add at least two tests, one of them a sample.",
  NEED_REFERENCE: "Add a reference solution.",
  ANSWER_NOT_AN_OPTION: "The correct answer must be one of the options.",
  NOT_FOUND: "That question no longer exists.",
};

export async function saveQuestion(payload: Record<string, unknown>): Promise<{ questionId: string; status: string }> {
  const r = await rows<{ ok: boolean; reason?: string; question_id?: string; status?: string }>(b2bDb.rpc("b2b_save_question", { _q: payload }));
  if (!r.ok) throw new Error(REASONS[r.reason ?? ""] ?? "Couldn't save the question.");
  return { questionId: r.question_id!, status: r.status! };
}

export async function setQuestionStatus(id: string, status: "draft" | "retired") {
  await rows(b2bDb.from("questions").update({ status }).eq("id", id).select("id"));
}

export function useAssessments(orgId: string) {
  return useQuery({
    queryKey: ["b2b-assess", "assessments", orgId],
    queryFn: () => rows<AssessmentRow[]>(b2bDb.from("assessments").select("*").eq("org_id", orgId).order("updated_at", { ascending: false })),
  });
}

export function useAssessment(id: string | undefined) {
  return useQuery({
    queryKey: ["b2b-assess", "assessment", id],
    enabled: !!id,
    queryFn: () => rows<AssessmentRow>(b2bDb.from("assessments").select("*").eq("id", id!).single()),
  });
}

export async function saveAssessment(id: string | undefined, row: Record<string, unknown>): Promise<string> {
  if (id) {
    await rows(b2bDb.from("assessments").update(row).eq("id", id).select("id"));
    return id;
  }
  const r = await rows<{ id: string }>(b2bDb.from("assessments").insert(row).select("id").single());
  return r.id;
}

export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/FORBIDDEN|permission|row-level security/i.test(m)) return "You don't have permission to do that.";
  return m;
}
