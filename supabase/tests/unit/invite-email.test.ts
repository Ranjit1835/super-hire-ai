// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderInvite } from "../../functions/_shared/invite-email";

describe("renderInvite", () => {
  it("escapes institution and student names in HTML", () => {
    const r = renderInvite({
      inviteId: "i", to: "a@x.in", studentName: "<script>x</script> Rao", orgName: 'A&B "College"',
      link: "https://hiresume.in/invite/abc_-123",
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("A&amp;B &quot;College&quot;");
    expect(r.html).toContain('href="https://hiresume.in/invite/abc_-123"');
    expect(r.subject).toBe('A&B "College" invited you to AI interview practice on HiResume');
    expect(r.text).toContain("https://hiresume.in/invite/abc_-123");
  });
});
