import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), signOut: vi.fn(), toast: vi.fn() }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: m.rpc } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: m.signOut } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));

import { __resetSessionForTests, endServerSession, heartbeat, HEARTBEAT_MIN_GAP_MS } from "./session";

const assign = vi.fn();
beforeEach(() => {
  __resetSessionForTests();
  m.rpc.mockReset(); m.signOut.mockReset().mockResolvedValue({ error: null }); m.toast.mockReset(); assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
  vi.useRealTimers();
});

describe("student session heartbeat (R1.6)", () => {
  it("a new login signs out the student's other devices", async () => {
    m.rpc.mockResolvedValue({ data: { ok: true, student: true, started: true }, error: null });
    await heartbeat(true);
    expect(m.rpc).toHaveBeenCalledWith("b2b_session_heartbeat");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(assign).not.toHaveBeenCalled();
  });

  it("an ended session signs out here with the reason", async () => {
    m.rpc.mockResolvedValue({ data: { ok: false, student: true, reason: "REPLACED" }, error: null });
    await heartbeat(true);
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/another device/) }));
    expect(assign).toHaveBeenCalledWith("/auth");
  });

  it("is throttled to one call a minute unless forced", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    m.rpc.mockResolvedValue({ data: { ok: true, student: true, started: false }, error: null });
    await heartbeat(true);
    await heartbeat();
    expect(m.rpc).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + HEARTBEAT_MIN_GAP_MS + 1);
    await heartbeat();
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });

  it("staff, B2C users and network failures never sign anyone out", async () => {
    m.rpc.mockResolvedValueOnce({ data: { ok: true, student: false }, error: null });
    await heartbeat(true);
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await heartbeat(true);
    m.rpc.mockRejectedValueOnce(new Error("boom"));
    await expect(heartbeat(true)).resolves.toBeUndefined();
    m.rpc.mockResolvedValueOnce(undefined);
    await expect(heartbeat(true)).resolves.toBeUndefined();
    expect(m.signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("logout ends the server session, best effort", async () => {
    m.rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(endServerSession()).resolves.toBeUndefined();
    expect(m.rpc).toHaveBeenCalledWith("b2b_session_end");
  });
});
