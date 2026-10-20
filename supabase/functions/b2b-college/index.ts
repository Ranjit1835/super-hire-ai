// b2b-college — TPO admins and trainers (contract: _shared/contracts/college.ts).
// Every action re-authorises in SQL (the functions in docs/b2b/tracks/d-college.sql take the actor and check
// org_admin / trainer membership themselves); this layer validates input, makes tokens and sends email.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, appBaseUrl, randomToken, serviceClient, sha256Hex } from "../_shared/b2b-http.ts";
import { serveContract, type Ctx } from "../_shared/contract-handler.ts";
import { collegeContract } from "../_shared/contracts/college.ts";
import { emailConfigured, esc, sendMail, staffInviteMail } from "../_shared/mailer.ts";
import { EXPORT_COLUMNS, MAX_EXPORT_ROWS, toExportRows, type AnalyticsRow } from "../_shared/college-table.ts";

const db = () => serviceClient();

const REASONS: Record<string, [number, string]> = {
  ORG_NOT_FOUND: [404, "College not found."],
  WRONG_ORG_TYPE: [400, "Students can only be added to a college."],
  DRIVE_CLOSED: [409, "This drive is closed."],
  RESULTS_NEVER: [409, "This drive is set to never release results to students."],
  ROLE_NOT_ALLOWED: [400, "That role isn't available for a college."],
  ALREADY_MEMBER: [409, "That person is already a member of this college."],
  INVALID_EMAIL: [400, "That email address doesn't look right."],
};
function refuse(reason: string | undefined): never {
  const [status, msg] = REASONS[reason ?? ""] ?? [400, "Request refused."];
  throw new HttpError(status, reason ?? "REFUSED", msg);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) {
    if (/FORBIDDEN|insufficient_privilege/.test(error.message)) throw new HttpError(403, "FORBIDDEN", "You don't have permission to do that.");
    throw error;
  }
  return data as T;
}

async function orgName(orgId: string): Promise<string> {
  const { data } = await db().from("organizations").select("name").eq("id", orgId).single();
  return (data?.name as string | undefined) ?? "your college";
}

function studentInviteMail(o: { to: string; name: string; orgName: string; link: string }) {
  const subject = `${o.orgName}: activate your HiResume account`;
  const text = `Hi ${o.name},\n\n${o.orgName} uses HiResume for placement tests, practice and interviews.\n` +
    `Activate your account (link valid for 30 days):\n${o.link}\n\n— HiResume (hiresume.in)`;
  const html = `<p>Hi ${esc(o.name)},</p><p><b>${esc(o.orgName)}</b> uses HiResume for placement tests, practice and interviews.</p>` +
    `<p><a href="${esc(o.link)}">Activate your account</a> (link valid for 30 days).</p><p>— HiResume (hiresume.in)</p>`;
  return { to: o.to, subject, html, text };
}

interface PreparedInvite { student_id: string; invite_id: string; email: string; full_name: string; token_index: number }

/** Resend batch API (100 per request), paced under the provider's default 2 requests/second. */
async function sendStudentInvites(org: string, invites: Array<PreparedInvite & { link: string }>): Promise<number> {
  if (!emailConfigured() || invites.length === 0) return 0;
  const key = Deno.env.get("RESEND_API_KEY")!;
  const from = Deno.env.get("B2B_EMAIL_FROM")!;
  let sent = 0;
  for (let i = 0; i < invites.length; i += 100) {
    const chunk = invites.slice(i, i + 100);
    const mails = chunk.map((inv) => studentInviteMail({ to: inv.email, name: inv.full_name, orgName: org, link: inv.link }));
    let error: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(mails.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }))),
      });
      if (!res.ok) error = `RESEND_${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    await db().rpc("b2b_mark_invite_email", { _invite_ids: chunk.map((c) => c.invite_id), _error: error });
    if (!error) sent += chunk.length;
    if (i + 100 < invites.length) await new Promise((r) => setTimeout(r, 600));
  }
  return sent;
}

async function inviteStudents(actor: string, orgId: string, studentIds: string[]) {
  const tokens = studentIds.map(() => randomToken());
  const hashes = await Promise.all(tokens.map(sha256Hex));
  const r = await rpc<{ invites: PreparedInvite[]; skipped: Array<{ student_id: string; reason: string }> }>(
    "b2b_prepare_student_invites", { _actor: actor, _org_id: orgId, _student_ids: studentIds, _token_hashes: hashes });
  const base = appBaseUrl();
  const invites = r.invites.map((inv) => ({ ...inv, link: `${base}/invite/${tokens[inv.token_index - 1]}` }));
  const queued = await sendStudentInvites(await orgName(orgId), invites);
  return {
    queued,
    links: invites.map((i) => ({ studentId: i.student_id, link: i.link })),
    skipped: r.skipped.map((s) => ({ studentId: s.student_id, reason: s.reason })),
    emailConfigured: emailConfigured(),
  };
}

type AnalyticsOut = { total: number; rows: AnalyticsRow[]; summary: unknown };
function analytics(ctx: Ctx, orgId: string, filters: unknown, page: number, pageSize: number, sort?: { by: string; dir: string }) {
  return rpc<AnalyticsOut>("b2b_college_analytics", {
    _actor: ctx.user.id, _org_id: orgId, _filters: filters, _page: page, _page_size: pageSize,
    _sort_by: sort?.by ?? null, _sort_dir: sort?.dir ?? null,
  });
}

serve(serveContract("B2B-COLLEGE", collegeContract, {
  async importStudents(input, ctx) {
    const r = await rpc<{
      ok: boolean; reason?: string; created: number; merged: number; skipped: number; heldMinors: number;
      duplicates: Array<{ row: number; reason: "roll_no" | "email" | "both" | "in_file"; existingStudentId: string | null }>;
      errors: Array<{ row: number; message: string }>; created_ids: string[]; merged_ids: string[];
    }>("b2b_import_students", {
      _actor: ctx.user.id, _org_id: input.orgId, _rows: input.rows, _on_duplicate: input.onDuplicate,
      _commit: input.mode === "commit",
    });
    if (!r.ok) refuse(r.reason);
    const out = {
      created: r.created, merged: r.merged, skipped: r.skipped, heldMinors: r.heldMinors,
      duplicates: r.duplicates, errors: r.errors,
    };
    if (input.mode === "commit" && input.sendInvites) {
      const ids = [...r.created_ids, ...r.merged_ids];
      if (ids.length) {
        // Held minors, active and deactivated students are skipped by the SQL function.
        const inv = await inviteStudents(ctx.user.id, input.orgId, ids);
        return { ...out, invites: inv.links, emailed: inv.queued };
      }
    }
    return out;
  },

  async inviteStudents(input, ctx) {
    return inviteStudents(ctx.user.id, input.orgId, input.studentIds);
  },

  async inviteStaff(input, ctx) {
    const token = randomToken();
    // b2b_invite_staff lets super admins and the org's admins through; it refuses trainers and outsiders.
    const r = await rpc<{ ok: boolean; reason?: string; invite_id?: string }>("b2b_invite_staff", {
      _actor: ctx.user.id, _org_id: input.orgId, _email: input.email, _full_name: input.fullName ?? null,
      _role: input.role, _token_hash: await sha256Hex(token),
    });
    if (!r.ok) refuse(r.reason);
    const link = `${appBaseUrl()}/invite/${token}`;
    const mail = await sendMail(staffInviteMail({
      to: input.email, name: input.fullName || input.email, orgName: await orgName(input.orgId), role: input.role, link,
    }));
    await db().rpc("b2b_mark_invite_email", { _invite_ids: [r.invite_id], _error: mail.sent ? null : mail.error });
    return { inviteId: r.invite_id!, link, emailed: mail.sent };
  },

  async previewEligibility(input, ctx) {
    return rpc<{ count: number; sample: Array<{ id: string; full_name: string; roll_no: string }> }>(
      "b2b_preview_eligibility", { _actor: ctx.user.id, _org_id: input.orgId, _elig: input.eligibility });
  },

  async assignDrive(input, ctx) {
    const r = await rpc<{ ok: boolean; reason?: string; assigned: number; alreadyAssigned: number; ineligible: number }>(
      "b2b_assign_drive", { _actor: ctx.user.id, _drive_id: input.driveId });
    if (!r.ok) refuse(r.reason);
    return { assigned: r.assigned, alreadyAssigned: r.alreadyAssigned, ineligible: r.ineligible };
  },

  async releaseResults(input, ctx) {
    const r = await rpc<{ ok: boolean; reason?: string }>("b2b_release_results", { _actor: ctx.user.id, _drive_id: input.driveId });
    if (!r.ok) refuse(r.reason);
    return { ok: true as const };
  },

  async analytics(input, ctx) {
    const r = await analytics(ctx, input.orgId, input.filters, input.page, input.pageSize, input.sort);
    return r as never;
  },

  async exportTable(input, ctx) {
    const r = await analytics(ctx, input.orgId, input.filters, 1, MAX_EXPORT_ROWS, { by: "roll_no", dir: "asc" });
    return { columns: [...EXPORT_COLUMNS], rows: toExportRows(r.rows) };
  },
}));
