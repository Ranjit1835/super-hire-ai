// Startup-portal emails (Resend via the injected sender) and completion notices, shared by b2b-company and
// b2b-candidate. Pure TypeScript with injected I/O, so it is unit-tested in Node.
export interface Mail { to: string; subject: string; html: string; text: string }

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function candidateInviteMail(o: { to: string; name: string; company: string; role: string; link: string; days: number }): Mail {
  const subject = `${o.company}: your assessment for ${o.role}`;
  const text = `Hi ${o.name},\n\n${o.company} has invited you to an online assessment for the ${o.role} role on HiResume ` +
    `(coding test and/or AI interview, with AI proctoring).\nStart here (link valid for ${o.days} days, just for you, no password needed):\n${o.link}\n\n` +
    `Use a laptop or desktop with Chrome or Edge, a webcam and a microphone.\n\n— HiResume (hiresume.in)`;
  const html = `<p>Hi ${esc(o.name)},</p><p><b>${esc(o.company)}</b> has invited you to an online assessment for the <b>${esc(o.role)}</b> role on HiResume ` +
    `(coding test and/or AI interview, with AI proctoring).</p><p><a href="${esc(o.link)}">Start your assessment</a> (valid for ${o.days} days, just for you, no password needed).</p>` +
    `<p>Use a laptop or desktop with Chrome or Edge, a webcam and a microphone.</p><p>— HiResume (hiresume.in)</p>`;
  return { to: o.to, subject, html, text };
}

export function completionMail(o: { to: string; candidate: string; role: string; link: string }): Mail {
  const subject = `${o.candidate} completed the ${o.role} assessment`;
  const text = `${o.candidate} has finished every step for ${o.role}. The report is ready:\n${o.link}\n\n` +
    `AI does not pass or fail candidates; your team decides.\n\n— HiResume (hiresume.in)`;
  const html = `<p><b>${esc(o.candidate)}</b> has finished every step for <b>${esc(o.role)}</b>.</p><p><a href="${esc(o.link)}">Open the report</a></p>` +
    `<p>AI does not pass or fail candidates; your team decides.</p><p>— HiResume (hiresume.in)</p>`;
  return { to: o.to, subject, html, text };
}

export interface NotifyDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  sendMail: (m: Mail) => Promise<{ sent: boolean; error: string | null }>;
  emailConfigured: () => boolean;
  baseUrl: () => string;
  log?: (msg: string) => void;
}

/** Email the role's recruiters about newly completed sessions (claimed once; no-op + logged without email). */
export async function notifyCompletions(deps: NotifyDeps, jobRoleId: string): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const notices = (await deps.rpc("b2b_claim_completion_notices", { _job_role_id: jobRoleId })) as Array<{
    role_candidate_id: string; org_id: string; role_title: string; candidate_name: string; recipients: string[] }> | null;
  let sent = 0;
  for (const n of notices ?? []) {
    const link = `${deps.baseUrl()}/co/${n.org_id}/candidates/${n.role_candidate_id}`;
    if (!deps.emailConfigured()) { log(`[b2b] completion notice not emailed (email not configured): ${n.role_candidate_id}`); continue; }
    for (const to of n.recipients ?? []) {
      const r = await deps.sendMail(completionMail({ to, candidate: n.candidate_name, role: n.role_title, link }));
      if (r.sent) sent++; else log(`[b2b] completion email to ${to} failed: ${r.error}`);
    }
  }
  return sent;
}
