import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import "../theme.css";

export interface ShellTab { to: string; label: string; end?: boolean }

/** Applies the scoped B2B theme to <body> while mounted (portals included), and removes it on unmount. */
export function useB2BTheme() {
  useEffect(() => {
    document.body.classList.add("b2b-theme");
    return () => document.body.classList.remove("b2b-theme");
  }, []);
}

export function V1Shell({ title, subtitle, tabs, actions, children }: {
  title: string; subtitle?: string; tabs?: ShellTab[]; actions?: ReactNode; children: ReactNode;
}) {
  useB2BTheme();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container max-w-6xl flex items-center gap-3 h-14 px-4">
          <img src="/logo.svg" alt="HiResume" className="h-7 w-7 rounded-md" />
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          {actions}
          <Link to="/dashboard" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                aria-label="Back to HiResume">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">HiResume</span>
          </Link>
          <button type="button" aria-label="Sign out" className="p-2 rounded-md text-muted-foreground hover:text-foreground"
                  onClick={async () => { await signOut(); navigate("/auth"); }}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {tabs && tabs.length > 0 && (
          <nav aria-label="Sections" className="container max-w-6xl px-4 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => cn("px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap",
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="container max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function Empty({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
