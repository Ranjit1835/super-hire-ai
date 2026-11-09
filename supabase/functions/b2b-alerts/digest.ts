// R1.9 daily alert digest for super admins, I/O injected (tested in supabase/tests/unit/alerts.test.ts).
export interface OrgAlert {
  org_id: string; org_name: string;
  kind: "low_credits" | "plan_expired" | "plan_expiring" | "seats_full";
  detail: Record<string, unknown>;
}
export interface DigestMail { to: string; subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function describeAlert(a: OrgAlert): string {
  const d = a.detail;
  switch (a.kind) {
    case "low_credits": return `${a.org_name}: ${Number(d.credits)} credits left (alert below ${Number(d.threshold)})`;
    case "plan_expired": return `${a.org_name}: plan ended on ${String(d.ends_at).slice(0, 10)}; access is blocked`;
    case "plan_expiring": return `${a.org_name}: plan ends in ${Number(d.days_left)} day${Number(d.days_left) === 1 ? "" : "s"} (${String(d.ends_at).slice(0, 10)})`;
    case "seats_full": return `${a.org_name}: ${Number(d.seats_used)} of ${Number(d.seat_limit)} seats used`;
  }
}

/** The digest email, or null when there is nothing to report (no email is sent then). */
export function buildDigest(alerts: OrgAlert[], to: string, adminUrl: string): DigestMail | null {
  if (!alerts.length) return null;
  const lines = alerts.map(describeAlert);
  const subject = `HiResume B2B: ${alerts.length} organisation alert${alerts.length === 1 ? "" : "s"}`;
  return {
    to, subject,
    text: `${lines.map((l) => `- ${l}`).join("\n")}\n\nReview: ${adminUrl}`,
    html: `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p><a href="${esc(adminUrl)}">Open the organisations page</a></p>`,
  };
}

export interface AlertDeps {
  alerts: () => Promise<OrgAlert[]>;
  send: (m: DigestMail) => Promise<{ sent: boolean; error: string | null }>;
  to: string | null;
  adminUrl: string;
}

export async function runDigest(d: AlertDeps): Promise<{ alerts: number; emailed: boolean; reason?: string }> {
  const alerts = await d.alerts();
  if (!d.to) return { alerts: alerts.length, emailed: false, reason: "NO_RECIPIENT" };
  const mail = buildDigest(alerts, d.to, d.adminUrl);
  if (!mail) return { alerts: 0, emailed: false, reason: "NOTHING_TO_REPORT" };
  const r = await d.send(mail);
  return { alerts: alerts.length, emailed: r.sent, ...(r.error ? { reason: r.error } : {}) };
}
