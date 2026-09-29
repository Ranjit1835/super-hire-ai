import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ state: { user: null as null | { id: string; email: string }, loading: false, signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.state }));
const b2b = vi.hoisted(() => ({ memberships: [] as unknown[], isSuper: false }));
vi.mock("@/features/b2b/hooks/useB2B", () => ({
  useMyMemberships: () => ({ data: b2b.memberships }),
  useIsSuperAdmin: () => ({ data: b2b.isSuper }),
}));

import { SiteHeader } from "./SiteHeader";

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><SiteHeader /></MemoryRouter>);
const mainNav = () => within(screen.getAllByRole("navigation", { name: "Main" })[0]);

describe("SiteHeader", () => {
  beforeEach(() => {
    auth.state = { user: null, loading: false, signOut: vi.fn() };
    b2b.memberships = [];
    b2b.isSuper = false;
  });

  it("gives visitors real links to every public product page", () => {
    renderAt("/pricing");
    const hrefs = mainNav().getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/ats-checker", "/build-resume", "/voice-interview", "/college-placement", "/pricing", "/blog"]);
    expect(mainNav().getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
  });

  it("signs visitors in and brings them back to the page they were on", () => {
    renderAt("/blog/what-is-ats-resume");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth?redirect=%2Fblog%2Fwhat-is-ats-resume");
  });

  it("shows signed-in users their tools and an account menu instead", () => {
    auth.state = { user: { id: "u1", email: "a@b.in" }, loading: false, signOut: vi.fn() };
    renderAt("/voice-interview");
    const hrefs = mainNav().getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/dashboard", "/studio", "/build-resume", "/voice-interview"]);
    expect(mainNav().getByRole("link", { name: "Interview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("renders the same neutral markup while auth is loading (as the pre-rendered HTML does)", () => {
    auth.state = { user: null, loading: true, signOut: vi.fn() };
    renderAt("/");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});
