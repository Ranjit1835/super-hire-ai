import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ShellTab {
  to: string;
  label: string;
  end?: boolean;
}

interface B2BShellProps {
  title: string;
  subtitle?: string;
  logoUrl?: string | null;
  isDemo?: boolean;
  tabs?: ShellTab[];
  actions?: ReactNode;
  children: ReactNode;
}

/** Calm, data-first chrome for institution screens (admins, trainers, students). */
export function B2BShell({ title, subtitle, logoUrl, isDemo, tabs, actions, children }: B2BShellProps) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {isDemo && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs text-center py-1.5">
          Demo institution — all students and scores are fictional
        </div>
      )}
      <header className="border-b border-border/60 bg-background sticky top-0 z-40">
        <div className="container max-w-6xl flex items-center gap-3 h-14 px-4">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 rounded-md object-contain bg-white/5" />
          ) : (
            <img src="/logo.svg" alt="HiResume" className="h-7 w-7 rounded-md" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-foreground truncate">{title}</h1>
              {isDemo && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">DEMO</Badge>
              )}
            </div>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          {actions}
          <button
            onClick={async () => {
              await signOut();
              navigate("/auth");
            }}
            className="text-muted-foreground hover:text-foreground p-2 rounded-md"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {tabs && tabs.length > 0 && (
          <nav className="container max-w-6xl px-4 flex gap-1 overflow-x-auto overflow-y-hidden" aria-label="Sections">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                    isActive
                      ? "border-violet-400 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
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

export function StatCard({
  label, value, hint, tone,
}: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold mt-1 tabular-nums",
          tone === "warn" && "text-amber-300",
          tone === "ok" && "text-emerald-300",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function CenteredSpinner() {
  return (
    <div className="flex justify-center py-24" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {body && <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
