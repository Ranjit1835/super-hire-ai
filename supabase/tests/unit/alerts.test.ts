// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { buildDigest, describeAlert, runDigest, type OrgAlert } from "../../functions/b2b-alerts/digest";

const alerts: OrgAlert[] = [
  { org_id: "1", org_name: "SVR <College>", kind: "plan_expired", detail: { ends_at: "2026-10-01T00:00:00Z" } },
  { org_id: "2", org_name: "Acme", kind: "low_credits", detail: { credits: 12, threshold: 50 } },
  { org_id: "3", org_name: "GVP", kind: "plan_expiring", detail: { ends_at: "2026-11-05T00:00:00Z", days_left: 1 } },
  { org_id: "4", org_name: "VIT", kind: "seats_full", detail: { seats_used: 290, seat_limit: 300 } },
];

describe("alert digest (R1.9)", () => {
  it("describes each alert in plain words", () => {
    expect(alerts.map(describeAlert)).toEqual([
      "SVR <College>: plan ended on 2026-10-01; access is blocked",
      "Acme: 12 credits left (alert below 50)",
      "GVP: plan ends in 1 day (2026-11-05)",
      "VIT: 290 of 300 seats used",
    ]);
  });

  it("builds one email with escaped HTML and a link to the admin page; nothing when there's nothing to say", () => {
    const m = buildDigest(alerts, "ops@hiresume.in", "https://hiresume.in/admin/orgs")!;
    expect(m.subject).toBe("HiResume B2B: 4 organisation alerts");
    expect(m.html).toContain("SVR &lt;College&gt;");
    expect(m.html).not.toContain("<College>");
    expect(m.text).toContain("https://hiresume.in/admin/orgs");
    expect(buildDigest([], "ops@hiresume.in", "x")).toBeNull();
  });

  it("emails only when there is a recipient and something to report", async () => {
    const send = vi.fn(async () => ({ sent: true, error: null }));
    expect(await runDigest({ alerts: async () => alerts, send, to: null, adminUrl: "u" })).toMatchObject({ emailed: false, reason: "NO_RECIPIENT" });
    expect(await runDigest({ alerts: async () => [], send, to: "a@b.in", adminUrl: "u" })).toMatchObject({ emailed: false, reason: "NOTHING_TO_REPORT" });
    expect(send).not.toHaveBeenCalled();
    expect(await runDigest({ alerts: async () => alerts, send, to: "a@b.in", adminUrl: "u" })).toEqual({ alerts: 4, emailed: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
