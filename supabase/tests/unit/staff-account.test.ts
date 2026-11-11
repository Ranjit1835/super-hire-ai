import { describe, it, expect, vi } from "vitest";
import { passwordProblems, provisionStaffAccount, temporaryPassword, type StaffAccountClient } from "../../functions/_shared/staff-account";

function fakeClient(createResult: Awaited<ReturnType<StaffAccountClient["auth"]["admin"]["createUser"]>>, accept = { ok: true }) {
  const createUser = vi.fn(async () => createResult);
  const rpc = vi.fn(async () => ({ data: accept, error: null }));
  return { client: { auth: { admin: { createUser } }, rpc } as unknown as StaffAccountClient, createUser, rpc };
}

describe("staff accounts made at invite time (owner, 2026-11-11)", () => {
  it("temporary passwords always meet the sign-up rules, avoid look-alikes and differ", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = temporaryPassword();
      expect(p).toHaveLength(14);
      expect(passwordProblems(p)).toEqual([]);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(500);
  });

  it("the password rules match sign-up", () => {
    expect(passwordProblems("short1A")).toContain("At least 8 characters");
    expect(passwordProblems("alllowercase1")).toContain("At least 1 uppercase letter");
    expect(passwordProblems("NoNumbersHere")).toContain("At least 1 number");
    expect(passwordProblems("GoodPass123")).toEqual([]);
  });

  it("a new email gets a confirmed account flagged to change its password, and the invite is accepted", async () => {
    const f = fakeClient({ data: { user: { id: "u-new" } }, error: null });
    const r = await provisionStaffAccount(f.client, { email: "tpo@college.in", fullName: "Asha", tokenHash: "h" }, () => "Temp@Pass2345");
    expect(r).toEqual({ created: true, userId: "u-new", tempPassword: "Temp@Pass2345" });
    expect(f.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "tpo@college.in", password: "Temp@Pass2345", email_confirm: true,
      app_metadata: { must_change_password: true }, user_metadata: { display_name: "Asha" },
    }));
    expect(f.rpc).toHaveBeenCalledWith("b2b_accept_invite", { _token_hash: "h", _user_id: "u-new", _consent_version: null, _consent_text: null });
  });

  it("an email that already has an account is left alone", async () => {
    const f = fakeClient({ data: null, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } });
    expect(await provisionStaffAccount(f.client, { email: "tpo@college.in", tokenHash: "h" })).toEqual({ created: false, userId: null, tempPassword: null });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("other errors are not mistaken for an existing account", async () => {
    const f = fakeClient({ data: null, error: { message: "Unable to validate email address: invalid format", status: 422 } });
    await expect(provisionStaffAccount(f.client, { email: "bad", tokenHash: "h" })).rejects.toThrow(/invalid format/);
  });
});
