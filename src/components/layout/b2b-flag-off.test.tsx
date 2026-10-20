import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Production build: VITE_B2B_ENABLED is not set.
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<typeof import("@/lib/config")>()), B2B_ENABLED: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.in" }, loading: false, signOut: vi.fn() }),
}));
vi.mock("@/features/b2b/hooks/useB2B", () => ({
  useMyMemberships: () => ({ data: [{ role: "org_admin", org_id: "org-a" }, { role: "student", org_id: "org-b" }] }),
  useIsSuperAdmin: () => ({ data: true }),
}));

import { SiteHeader } from "./SiteHeader";

describe("header with B2B switched off", () => {
  it("links to no institution or student area, and super admin only to the enquiries inbox", () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><SiteHeader /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.queryByRole("link", { name: /Institution dashboard/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /My interview practice/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Super admin/ })).toHaveAttribute("href", "/admin/enquiries");
  });
});
