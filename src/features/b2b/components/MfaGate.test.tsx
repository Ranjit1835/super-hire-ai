import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  aal: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "sa" } }) }));
vi.mock("../lib/db", () => ({ b2bDb: { rpc: m.rpc } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { mfa: {
    getAuthenticatorAssuranceLevel: m.aal, listFactors: m.listFactors, enroll: m.enroll, unenroll: m.unenroll,
    challenge: m.challenge, verify: m.verify,
  } } },
}));

import { MfaGate } from "./MfaGate";

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MfaGate><p>admin console</p></MfaGate>
  </QueryClientProvider>,
);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.challenge.mockResolvedValue({ data: { id: "ch1" }, error: null });
});

describe("super admin MFA gate (R3.5)", () => {
  it("non-admins pass straight through", async () => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    wrap();
    expect(await screen.findByText("admin console")).toBeInTheDocument();
    expect(m.aal).not.toHaveBeenCalled();
  });

  it("an admin already at aal2 sees the console", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    m.aal.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    wrap();
    expect(await screen.findByText("admin console")).toBeInTheDocument();
  });

  it("first time: enrol with a QR code, verify the code, then the console opens", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    m.aal.mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null })
      .mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    m.listFactors.mockResolvedValue({ data: { all: [{ id: "old", factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    m.enroll.mockResolvedValue({ data: { id: "f1", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABCD" } }, error: null });
    m.verify.mockResolvedValue({ data: {}, error: null });
    wrap();
    expect(screen.queryByText("admin console")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    expect(m.unenroll).toHaveBeenCalledWith({ factorId: "old" });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(m.verify).toHaveBeenCalledWith({ factorId: "f1", challengeId: "ch1", code: "123456" }));
    expect(await screen.findByText("admin console")).toBeInTheDocument();
  });

  it("an enrolled admin at aal1 verifies a code; a wrong code is explained and the console stays closed", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    m.aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    m.listFactors.mockResolvedValue({ data: { all: [], totp: [{ id: "f9" }] }, error: null });
    m.verify.mockResolvedValue({ data: null, error: { message: "invalid" } });
    wrap();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't work/);
    expect(screen.queryByText("admin console")).toBeNull();
    expect(m.enroll).not.toHaveBeenCalled();
  });
});
