import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  user: { id: "u1", app_metadata: { must_change_password: true } } as { id: string; app_metadata: Record<string, unknown> } | null,
  invoke: vi.fn(),
  refresh: vi.fn(async () => ({})),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, signOut: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: state.invoke }, auth: { refreshSession: state.refresh } },
}));

import { PasswordChangeGate } from "./PasswordChangeGate";

const at = (path = "/c/org/students") => render(<MemoryRouter initialEntries={[path]}><PasswordChangeGate /></MemoryRouter>);

beforeEach(() => {
  state.user = { id: "u1", app_metadata: { must_change_password: true } };
  state.invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  state.refresh.mockClear();
});

describe("first sign-in password change (owner, 2026-11-11)", () => {
  it("asks for a new password that meets the rules and saves it", async () => {
    at();
    const save = screen.getByRole("button", { name: "Save password" });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "weak" } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Needs:/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPass123" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "NewPass12" } });
    expect(save).toBeDisabled();                                         // doesn't match yet
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "NewPass123" } });
    fireEvent.click(save);
    await waitFor(() => expect(state.invoke).toHaveBeenCalledWith("account-password", { body: { password: "NewPass123" } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.refresh).toHaveBeenCalled();
  });

  it("does nothing for accounts without the flag, or on the sign-in page", () => {
    state.user = { id: "u2", app_metadata: {} };
    const a = at();
    expect(screen.queryByRole("dialog")).toBeNull();
    a.unmount();
    state.user = { id: "u1", app_metadata: { must_change_password: true } };
    at("/auth");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
