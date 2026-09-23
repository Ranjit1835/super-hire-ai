// ─── Invite emails via Resend (batch API, ≤100 per request) ───────────────────
// B2B_EMAIL_FROM must be an address on a domain verified in Resend
// (e.g. "HiResume <invites@hiresume.in>"). Resend's onboarding@resend.dev sender only
// delivers to the Resend account owner, so it is useless for student invites.

export interface InviteEmail {
  inviteId: string;
  to: string;
  studentName: string;
  orgName: string;
  link: string;
}

export interface SendResult {
  sent: string[];   // invite ids
  failed: string[]; // invite ids
  error: string | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function renderInvite(e: InviteEmail): { subject: string; html: string; text: string } {
  const first = e.studentName.split(" ")[0] || e.studentName;
  const subject = `${e.orgName} invited you to AI interview practice on HiResume`;
  const text =
    `Hi ${first},\n\n${e.orgName} has set up AI mock interviews for your batch on HiResume.\n` +
    `Accept your invite (valid for 30 days):\n${e.link}\n\n` +
    `You'll practise voice interviews on the topics your institution chose and get a detailed report after each one.\n\n` +
    `If you weren't expecting this, you can ignore this email.\n— HiResume`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="font-size:16px;margin:0 0 16px">Hi ${esc(first)},</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px"><strong>${esc(e.orgName)}</strong> has set up AI mock interviews for your batch on HiResume.</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#424245">You'll practise voice interviews on the topics your institution chose and get a detailed report after each one.</p>
<p style="margin:0 0 24px"><a href="${esc(e.link)}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;font-size:15px">Accept invite</a></p>
<p style="font-size:13px;color:#6e6e73;line-height:1.5;margin:0">This link is personal and valid for 30 days. If the button doesn't work, open:<br><a href="${esc(e.link)}" style="color:#6d28d9;word-break:break-all">${esc(e.link)}</a></p>
<p style="font-size:13px;color:#6e6e73;margin:16px 0 0">If you weren't expecting this, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

export async function sendInviteEmails(emails: InviteEmail[]): Promise<SendResult> {
  const result: SendResult = { sent: [], failed: [], error: null };
  if (!emails.length) return result;
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("B2B_EMAIL_FROM");
  if (!key || !from) {
    result.failed = emails.map((e) => e.inviteId);
    result.error = "Email sending is not configured (RESEND_API_KEY / B2B_EMAIL_FROM). Share the invite links instead.";
    return result;
  }

  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((e) => ({ from, to: [e.to], ...renderInvite(e) }))),
      });
      if (res.ok) {
        result.sent.push(...chunk.map((e) => e.inviteId));
      } else {
        const body = await res.text();
        console.error("[invite-email] Resend error", res.status, body.slice(0, 300));
        result.failed.push(...chunk.map((e) => e.inviteId));
        result.error = `Email provider returned ${res.status}`;
      }
    } catch (e) {
      console.error("[invite-email] network error", e);
      result.failed.push(...chunk.map((x) => x.inviteId));
      result.error = "Could not reach the email provider";
    }
    if (i + 100 < emails.length) await new Promise((r) => setTimeout(r, 600)); // stay under Resend's 2 req/s
  }
  return result;
}
