// Transactional email via Resend. B2B_EMAIL_FROM must be on a domain verified in Resend; until then
// sending is skipped and callers hand out the link instead (they always get it back).
export interface Mail { to: string; subject: string; html: string; text: string }
export interface MailResult { sent: boolean; error: string | null }

export function emailConfigured(): boolean {
  return !!(Deno.env.get("RESEND_API_KEY") && Deno.env.get("B2B_EMAIL_FROM"));
}

export async function sendMail(m: Mail): Promise<MailResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("B2B_EMAIL_FROM");
  if (!key || !from) return { sent: false, error: "EMAIL_NOT_CONFIGURED" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    });
    if (!res.ok) return { sent: false, error: `RESEND_${res.status}` };
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: (e as Error).message.slice(0, 200) };
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const ROLE_LABEL: Record<string, string> = {
  org_admin: "admin", trainer: "trainer", recruiter: "recruiter", hiring_manager: "hiring manager",
};

export function staffInviteMail(o: { to: string; name: string; orgName: string; role: string; link: string }): Mail {
  const role = ROLE_LABEL[o.role] ?? o.role;
  const subject = `You're invited to ${o.orgName} on HiResume`;
  const text = `Hi ${o.name},\n\nYou've been added as ${role} for ${o.orgName} on HiResume.\n` +
    `Accept the invite (valid for 14 days, for ${o.to} only):\n${o.link}\n\n— HiResume (hiresume.in)`;
  const html = `<p>Hi ${esc(o.name)},</p><p>You've been added as <b>${esc(role)}</b> for <b>${esc(o.orgName)}</b> on HiResume.</p>` +
    `<p><a href="${esc(o.link)}">Accept the invite</a> (valid for 14 days, for ${esc(o.to)} only).</p><p>— HiResume (hiresume.in)</p>`;
  return { to: o.to, subject, html, text };
}
