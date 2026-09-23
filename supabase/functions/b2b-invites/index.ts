// B2B student onboarding: CSV import → invite links/emails → accept (with consent).
//
// Actions
//   import   (org admin)  { orgId, rows: RosterRow[], sendEmail }  → per-row results + one-time links
//   resend   (org admin)  { inviteId, sendEmail }                  → new link (old one stops working)
//   revoke   (org admin)  { inviteId }
//   preview  (public)     { token }                                → org, student name, account exists?
//   register (public)     { token, password, consent: true }       → creates account for the invited email + accepts
//   accept   (signed in)  { token, consent: true }                 → attaches the signed-in account
//
// Authorization is re-checked inside each SQL function (actor_is_org_admin), not only here.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  HttpError, appBaseUrl, handle, json, randomToken, requireUser, serviceClient, sha256Hex, str, uuid,
} from "../_shared/b2b-http.ts";
import { validateRosterRows } from "../_shared/invite-csv.ts";
import { sendInviteEmails, type InviteEmail } from "../_shared/invite-email.ts";
import { B2B_CONSENT_VERSION, b2bConsentText } from "../_shared/b2b-consent.ts";

type ImportResult = { row: number; status: "invited" | "skipped" | "error"; reason?: string; invite_id?: string };

const ACCEPT_ERRORS: Record<string, [number, string]> = {
  INVALID: [404, "This invite link is not valid. Ask your placement office for a new one."],
  EXPIRED: [410, "This invite link has expired. Ask your placement office to resend it."],
  REVOKED: [410, "This invite was withdrawn by your institution."],
  ALREADY_USED: [409, "This invite has already been used by another account."],
  STAFF_ACCOUNT: [409, "This account is registered as staff at this institution."],
  STUDENT_LIMIT_REACHED: [409, "Your institution has reached its student limit. Please contact your placement office."],
  ROLL_NO_TAKEN: [409, "Another student with this roll number already joined. Please contact your placement office."],
  CONSENT_REQUIRED: [400, "Please accept the consent to continue."],
};

function inviteLink(token: string) {
  return `${appBaseUrl()}/invite/${token}`;
}

function checkPassword(pw: string) {
  const problems: string[] = [];
  if (pw.length < 8) problems.push("at least 8 characters");
  if (pw.length > 72) problems.push("at most 72 characters");
  if (!/[A-Z]/.test(pw)) problems.push("1 uppercase letter");
  if (!/[0-9]/.test(pw)) problems.push("1 number");
  if (problems.length) throw new HttpError(400, "WEAK_PASSWORD", `Password needs ${problems.join(", ")}.`);
}

async function loadPreview(tokenHash: string) {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("b2b_invite_preview", { _token_hash: tokenHash });
  if (error) throw error;
  if (!data) throw new HttpError(404, "INVALID", ACCEPT_ERRORS.INVALID[1]);
  return data as {
    invite_id: string; status: string; full_name: string; email: string; roll_no: string; batch: string | null;
    org: { id: string; name: string; type: string; logo_url: string | null; is_demo: boolean };
  };
}

async function acceptAs(tokenHash: string, userId: string, orgName: string) {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("b2b_accept_invite", {
    _token_hash: tokenHash, _user_id: userId,
    _consent_version: B2B_CONSENT_VERSION, _consent_text: b2bConsentText(orgName),
  });
  if (error) throw error;
  const r = data as { ok: boolean; reason?: string; org_id?: string };
  if (!r.ok) {
    const [status, msg] = ACCEPT_ERRORS[r.reason ?? ""] ?? [400, "Could not accept the invite."];
    throw new HttpError(status, r.reason ?? "ACCEPT_FAILED", msg);
  }
  return r;
}

serve(handle("B2B-INVITES", async (req, body) => {
  const action = str(body.action, "action", 20);
  const admin = serviceClient();

  // ── Org admin actions ──────────────────────────────────────────────────────
  if (action === "import") {
    const user = await requireUser(req);
    const orgId = uuid(body.orgId, "orgId");
    const checked = validateRosterRows(body.rows);
    if (checked.fileErrors.length) throw new HttpError(400, "BAD_ROWS", checked.fileErrors.join(" "));

    const { data: org, error: orgErr } = await admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
    if (orgErr) throw orgErr;
    if (!org) throw new HttpError(404, "NOT_FOUND", "Institution not found");

    const tokens = new Map<number, string>();
    const rows = await Promise.all(checked.rows.map(async (r) => {
      const token = randomToken();
      tokens.set(r.row, token);
      return { ...r, token_hash: await sha256Hex(token) };
    }));

    const { data, error } = await admin.rpc("b2b_import_invites", { _actor: user.id, _org_id: orgId, _rows: rows });
    if (error) throw error;
    const dbResults = data as ImportResult[];

    const byRow = new Map(checked.rows.map((r) => [r.row, r]));
    const invited = dbResults
      .filter((r) => r.status === "invited")
      .map((r) => {
        const src = byRow.get(r.row)!;
        return { row: r.row, invite_id: r.invite_id!, full_name: src.full_name, email: src.email, roll_no: src.roll_no, link: inviteLink(tokens.get(r.row)!) };
      });

    let email = { sent: 0, failed: 0, error: null as string | null };
    if (body.sendEmail === true && invited.length) {
      const res = await sendInviteEmails(invited.map<InviteEmail>((i) => ({
        inviteId: i.invite_id, to: i.email, studentName: i.full_name, orgName: org.name, link: i.link,
      })));
      if (res.sent.length) await admin.rpc("b2b_mark_invite_email", { _invite_ids: res.sent, _error: null });
      if (res.failed.length) await admin.rpc("b2b_mark_invite_email", { _invite_ids: res.failed, _error: res.error });
      email = { sent: res.sent.length, failed: res.failed.length, error: res.error };
    }

    const results = [
      ...checked.errors.map((e) => ({ row: e.row, status: "error" as const, reason: e.errors.join("; ") })),
      ...dbResults.map(({ row, status, reason }) => ({ row, status, reason })),
    ].sort((a, b) => a.row - b.row);

    console.log(`[B2B-INVITES] import org=${orgId} by=${user.id} invited=${invited.length} rows=${results.length}`);
    return json({ results, invited, email });
  }

  if (action === "resend") {
    const user = await requireUser(req);
    const inviteId = uuid(body.inviteId, "inviteId");
    const token = randomToken();
    const { data, error } = await admin.rpc("b2b_rotate_invite", {
      _actor: user.id, _invite_id: inviteId, _new_token_hash: await sha256Hex(token),
    });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string; email?: string; full_name?: string; org_id?: string };
    if (!r.ok) throw new HttpError(409, r.reason ?? "NOT_PENDING", `This invite is ${String(r.reason).toLowerCase()}.`);
    const link = inviteLink(token);

    let email = { sent: 0, failed: 0, error: null as string | null };
    if (body.sendEmail === true) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", r.org_id!).single();
      const res = await sendInviteEmails([{ inviteId, to: r.email!, studentName: r.full_name!, orgName: org?.name ?? "Your institution", link }]);
      await admin.rpc("b2b_mark_invite_email", { _invite_ids: [inviteId], _error: res.error });
      email = { sent: res.sent.length, failed: res.failed.length, error: res.error };
    }
    return json({ link, email });
  }

  if (action === "revoke") {
    const user = await requireUser(req);
    const { data, error } = await admin.rpc("b2b_revoke_invite", { _actor: user.id, _invite_id: uuid(body.inviteId, "inviteId") });
    if (error) throw error;
    return json(data);
  }

  // ── Student actions ────────────────────────────────────────────────────────
  const token = str(body.token, "token", 100);
  const tokenHash = await sha256Hex(token);

  if (action === "preview") {
    const p = await loadPreview(tokenHash);
    const { data: hasAccount } = await admin.rpc("b2b_email_has_account", { _email: p.email });
    return json({
      status: p.status,
      full_name: p.full_name,
      email: p.email,
      roll_no: p.roll_no,
      batch: p.batch,
      org: p.org,
      has_account: !!hasAccount,
      consent: { version: B2B_CONSENT_VERSION, text: b2bConsentText(p.org.name) },
    });
  }

  if (body.consent !== true) throw new HttpError(400, "CONSENT_REQUIRED", ACCEPT_ERRORS.CONSENT_REQUIRED[1]);

  if (action === "register") {
    const password = str(body.password, "password", 200);
    checkPassword(password);
    const p = await loadPreview(tokenHash);
    if (p.status !== "pending") {
      const [status, msg] = ACCEPT_ERRORS[p.status.toUpperCase()] ?? ACCEPT_ERRORS.INVALID;
      throw new HttpError(status, p.status.toUpperCase(), msg);
    }
    // Account is created for the invited email only; the link was delivered to it by the institution.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: p.full_name, source: "b2b_invite" },
    });
    if (createErr || !created.user) {
      if (/already|registered|exists/i.test(createErr?.message ?? "")) {
        throw new HttpError(409, "ACCOUNT_EXISTS", "An account already exists for this email. Sign in to accept the invite.");
      }
      throw createErr ?? new Error("createUser returned no user");
    }
    try {
      const r = await acceptAs(tokenHash, created.user.id, p.org.name);
      console.log(`[B2B-INVITES] register+accept org=${r.org_id} user=${created.user.id}`);
      return json({ ok: true, org_id: r.org_id, email: p.email });
    } catch (e) {
      await admin.auth.admin.deleteUser(created.user.id); // don't leave an orphan account behind
      throw e;
    }
  }

  if (action === "accept") {
    const user = await requireUser(req);
    const p = await loadPreview(tokenHash);
    const r = await acceptAs(tokenHash, user.id, p.org.name);
    console.log(`[B2B-INVITES] accept org=${r.org_id} user=${user.id}`);
    return json({ ok: true, org_id: r.org_id });
  }

  throw new HttpError(400, "BAD_REQUEST", "Unknown action");
}));
