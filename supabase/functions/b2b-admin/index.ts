// b2b-admin — super admin API (contract: _shared/contracts/admin.ts).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, appBaseUrl, randomToken, serviceClient, sha256Hex } from "../_shared/b2b-http.ts";
import { serveContract, type Ctx } from "../_shared/contract-handler.ts";
import { adminContract } from "../_shared/contracts/admin.ts";
import { sendMail, staffInviteMail } from "../_shared/mailer.ts";

const db = () => serviceClient();

async function requireSuperAdmin(ctx: Ctx) {
  const { data, error } = await db().rpc("actor_is_super_admin", { _actor: ctx.user.id });
  if (error) throw error;
  if (!data) throw new HttpError(403, "FORBIDDEN", "Super admin only.");
}

const REASONS: Record<string, [number, string]> = {
  PLAN_NOT_FOUND: [400, "That plan doesn't exist or is retired."],
  PLAN_ORG_TYPE_MISMATCH: [400, "That plan is for a different kind of organisation."],
  SLUG_TAKEN: [409, "That link name is already used by another organisation."],
  ORG_NOT_FOUND: [404, "Organisation not found."],
  ROLE_NOT_ALLOWED: [400, "That role isn't available for this kind of organisation."],
  ALREADY_MEMBER: [409, "That person is already a member of this organisation."],
  INVALID_EMAIL: [400, "That email address doesn't look right."],
};
function refuse(reason: string): never {
  const [status, msg] = REASONS[reason] ?? [400, "Request refused."];
  throw new HttpError(status, reason, msg);
}

async function inviteStaff(actor: string, orgId: string, email: string, fullName: string | undefined, role: string) {
  const token = randomToken();
  const { data, error } = await db().rpc("b2b_invite_staff", {
    _actor: actor, _org_id: orgId, _email: email, _full_name: fullName ?? null, _role: role, _token_hash: await sha256Hex(token),
  });
  if (error) throw error;
  const r = data as { ok: boolean; reason?: string; invite_id?: string };
  if (!r.ok) refuse(r.reason!);
  const link = `${appBaseUrl()}/invite/${token}`;
  const { data: org } = await db().from("organizations").select("name").eq("id", orgId).single();
  const mail = await sendMail(staffInviteMail({ to: email, name: fullName || email, orgName: org?.name ?? "your organisation", role, link }));
  await db().rpc("b2b_mark_invite_email", { _invite_ids: [r.invite_id], _error: mail.sent ? null : mail.error });
  return { inviteId: r.invite_id!, link, emailed: mail.sent };
}

serve(serveContract("B2B-ADMIN", adminContract, {
  async createOrg(input, ctx) {
    await requireSuperAdmin(ctx);
    const { admin, initialCredits, ...org } = input;
    const { data, error } = await db().rpc("super_create_org", { _actor: ctx.user.id, _org: org, _initial_credits: initialCredits ?? null });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string; org_id?: string; credits?: number };
    if (!r.ok) refuse(r.reason!);
    const invite = admin ? await inviteStaff(ctx.user.id, r.org_id!, admin.email, admin.fullName, "org_admin") : null;
    return { orgId: r.org_id!, credits: Number(r.credits ?? 0), invite };
  },

  async updateOrg(input, ctx) {
    await requireSuperAdmin(ctx);
    const { orgId, ...patch } = input;
    const { data, error } = await db().rpc("super_update_org", { _actor: ctx.user.id, _org_id: orgId, _patch: patch });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string };
    if (!r.ok) refuse(r.reason!);
    return { ok: true as const };
  },

  async inviteStaff(input, ctx) {
    await requireSuperAdmin(ctx);
    return inviteStaff(ctx.user.id, input.orgId, input.email, input.fullName, input.role);
  },

  async revokeInvite(input, ctx) {
    await requireSuperAdmin(ctx);
    const { data, error } = await db().rpc("b2b_revoke_invite", { _actor: ctx.user.id, _invite_id: input.inviteId });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string };
    if (!r.ok) throw new HttpError(409, r.reason ?? "NOT_PENDING", "Only pending invites can be withdrawn.");
    return { ok: true as const };
  },
}));
