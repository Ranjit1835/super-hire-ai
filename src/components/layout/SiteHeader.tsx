// The one site header: the same logo, links and account controls on marketing and app pages.
// Signed-out visitors see the product links; signed-in users see their tools and an account
// menu. Links are real <a href> (react-router Link) so they work with a middle-click and crawlers
// can follow them.
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, ChevronDown, LogOut, Menu, Shield, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useIsSuperAdmin, useMyMemberships } from "@/features/b2b/hooks/useB2B";
import { authUrlFor } from "@/lib/safe-redirect";
import { B2B_ENABLED } from "@/lib/config";
import { ACCOUNT_NAV, APP_NAV, PUBLIC_NAV, type NavLinkItem } from "./site-nav";

export const HEADER_HEIGHT_CLASS = "h-16";

function isActive(item: NavLinkItem, pathname: string) {
  return pathname === item.href || (item.alsoActive ?? []).some((p) => pathname.startsWith(p));
}

/** Institution / admin areas the signed-in user can open, if any. */
function useWorkspaceLinks(): { href: string; label: string; icon: typeof Building2 }[] {
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  const links = [];
  const staff = memberships.data?.find((m) => m.role !== "student");
  const student = memberships.data?.find((m) => m.role === "student");
  if (B2B_ENABLED && staff) links.push({ href: `/org/${staff.org_id}`, label: "Institution dashboard", icon: Building2 });
  else if (B2B_ENABLED && student) links.push({ href: "/learn", label: "My interview practice", icon: Building2 });
  // With B2B switched off the only admin page is the institution-enquiries inbox (fed by the B2C college page).
  if (isSuper.data) links.push({ href: B2B_ENABLED ? "/admin/orgs" : "/admin/enquiries", label: "Super admin", icon: Shield });
  return links;
}

function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const workspaces = useWorkspaceLinks();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Account menu"
        >
          <span className="h-7 w-7 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-violet-300" />
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.href} asChild>
            <Link to={w.href}><w.icon className="h-4 w-4 mr-2" />{w.label}</Link>
          </DropdownMenuItem>
        ))}
        {workspaces.length > 0 && <DropdownMenuSeparator />}
        {ACCOUNT_NAV.map((l) => (
          <DropdownMenuItem key={l.href} asChild>
            <Link to={l.href}>{l.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            navigate("/", { replace: true });
          }}
        >
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * @param spacer Reserve the header's height in the page flow. App pages need it; marketing pages
 *               already leave room for the fixed header in their own top padding.
 */
export function SiteHeader({ spacer = false }: { spacer?: boolean }) {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const links = user ? APP_NAV : PUBLIC_NAV;
  const here = location.pathname + location.search;
  const workspaces = useWorkspaceLinks();

  return (
    <>
      <header className={`fixed top-0 inset-x-0 z-50 glass-strong border-b border-border/30 ${HEADER_HEIGHT_CLASS}`}>
        <div className="container h-full flex items-center justify-between gap-4 px-4">
          <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2 shrink-0" aria-label="HiResume home">
            <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
            <span className="font-bold text-lg text-foreground tracking-tight">HiResume</span>
          </Link>

          <nav aria-label="Main" className="hidden lg:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                to={l.href}
                aria-current={isActive(l, location.pathname) ? "page" : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(l, location.pathname)
                    ? "text-foreground bg-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {loading ? (
              // Same markup on the server and on first client render; auth resolves after hydration.
              <div className="w-24" aria-hidden />
            ) : user ? (
              <div className="hidden lg:block"><AccountMenu /></div>
            ) : (
              <>
                <Link
                  to={authUrlFor(here)}
                  className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                >
                  Sign in
                </Link>
                <Button asChild size="sm" className="hidden sm:inline-flex bg-gradient-to-r from-violet-600 to-cyan-600 border-0 shadow-lg shadow-violet-500/20">
                  <Link to="/auth">Get started <ArrowRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              </>
            )}
            <button
              onClick={() => setOpen((o) => !o)}
              className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <nav
          id="site-menu"
          aria-label="Main"
          className="fixed top-16 inset-x-0 z-[49] glass-strong border-b border-border/30 shadow-2xl lg:hidden max-h-[calc(100vh-4rem)] overflow-y-auto"
        >
          <div className="p-3 space-y-1">
            {[...links, ...(user ? [...workspaces, ...ACCOUNT_NAV] : [])].map((l) => (
              <Link
                key={l.href}
                to={l.href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive(l, location.pathname) ? "text-foreground bg-violet-500/10" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="pt-2 px-2 flex gap-2">
              {user ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => { setOpen(false); await signOut(); navigate("/", { replace: true }); }}
                >
                  <LogOut className="h-4 w-4 mr-1" /> Sign out
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={authUrlFor(here)} onClick={() => setOpen(false)}>Sign in</Link>
                  </Button>
                  <Button asChild size="sm" className="flex-1 bg-gradient-to-r from-violet-600 to-cyan-600 border-0">
                    <Link to="/auth" onClick={() => setOpen(false)}>Get started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </nav>
      )}

      {spacer && <div className={HEADER_HEIGHT_CLASS} aria-hidden />}
    </>
  );
}
