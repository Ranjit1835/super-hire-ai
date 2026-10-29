import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { LogoMark, Numeral } from "../ui/broadcast";
import { Stage, type StageStep } from "../three/Stage";
import { EASE_OUT, useReducedMotion } from "../motion";
import { endServerSession, useStudentSession } from "../session";
import "../theme.css";

export interface ShellTab { to: string; label: string; end?: boolean }

/**
 * Applies the scoped B2B theme to <body> while mounted (portals included), and removes it on unmount. B2B screens are
 * private (portals, candidate and share links carry their own access), so they are also marked noindex while mounted.
 */
export function useB2BTheme() {
  useStudentSession();   // R1.6: every B2B screen keeps the student's session honest
  useEffect(() => {
    document.body.classList.add("b2b-theme");
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    meta.setAttribute("data-b2b", "");
    document.head.appendChild(meta);
    return () => { document.body.classList.remove("b2b-theme"); meta.remove(); };
  }, []);
}

/** The browser tab names the screen, not the marketing site. */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} · HiResume`;
    return () => { document.title = before; };
  }, [title]);
}

/**
 * The frame of every B2B work screen: one broadcast bar (mark, org and role, section tabs, account) over a wide work
 * area. Route changes fade in with a 4px rise; nothing else in the frame moves.
 */
export function V1Shell({ title, subtitle, tabs, actions, aside, children }: {
  title: string; subtitle?: string; tabs?: ShellTab[]; actions?: ReactNode;
  /** Org facts shown at the right of the bar on desktop, e.g. the credit balance. */
  aside?: ReactNode; children: ReactNode;
}) {
  useB2BTheme();
  usePageTitle(title);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-[var(--hr-ground)] hr-rule-b">
        <div className="mx-auto max-w-[1440px] flex flex-wrap items-stretch px-4 gap-x-4">
          <div className="flex items-center gap-3 min-w-0 shrink h-14">
            <span className="inline-flex items-center gap-2 shrink-0">
              <LogoMark title="HiResume" />
              <span aria-hidden className="hidden xl:inline hr-display text-[15px] text-[var(--hr-muted)]">HiResume</span>
            </span>
            <span aria-hidden className="hidden xl:block h-7 w-px bg-[var(--hr-rule)]" />
            <div className="min-w-0">
              <h1 className="hr-display text-[17px] truncate max-w-[60vw] lg:max-w-[22rem]">{title}</h1>
              {subtitle && <p className="hr-label !text-[10px] truncate max-w-[60vw] lg:max-w-[22rem]">{subtitle}</p>}
            </div>
          </div>
          {tabs && tabs.length > 0 && (
            <nav aria-label="Sections"
                 className="order-last lg:order-none basis-full lg:basis-auto flex items-stretch min-w-0 overflow-x-auto h-10 lg:h-14 -mx-4 px-2 lg:mx-0 lg:px-0 hr-rule-t lg:shadow-none [mask-image:linear-gradient(to_right,#000_85%,transparent)] lg:[mask-image:none]">
              {tabs.map((t) => <ShellTabLink key={t.to} tab={t} />)}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0 h-14 max-w-[45vw] lg:max-w-none overflow-x-auto">
            {aside && <div className="hidden lg:flex items-center pr-3 mr-1 shadow-[inset_-1px_0_0_var(--hr-rule)]">{aside}</div>}
            {actions}
            <Link to="/dashboard" aria-label="Back to HiResume"
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-[var(--hr-muted)] hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">HiResume</span>
            </Link>
            <button type="button" aria-label="Sign out" className="p-2 text-[var(--hr-muted)] hover:text-foreground"
                    onClick={async () => { await endServerSession(); await signOut(); navigate("/auth"); }}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <motion.main className="mx-auto max-w-[1440px] px-4 sm:px-6 py-5"
                   initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                   transition={{ duration: 0.16, ease: EASE_OUT }}>
        {children}
      </motion.main>
    </div>
  );
}

function ShellTabLink({ tab }: { tab: ShellTab }) {
  return (
    <NavLink to={tab.to} end={tab.end}
      className={({ isActive }) => cn(
        "inline-flex items-center h-full px-3.5 text-[12px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap",
        // Decision D5: the active section is underlined, so orange fills stay reserved for the one primary action.
        isActive ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)] hover:text-foreground hover:bg-[var(--hr-surface)]")}>
      {tab.label}
    </NavLink>
  );
}

/** One counter cell: a label and a headline value (drives in), with an optional hint line. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  const plain = typeof value === "number" || typeof value === "string";
  return (
    <div className="bg-[var(--hr-surface)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--hr-rule)]">
      <p className="hr-label">{label}</p>
      <p className="text-[30px] mt-1.5 leading-none">{plain ? <Numeral value={value as number | string} /> : value}</p>
      {hint && <p className="text-xs text-[var(--hr-muted)] mt-1.5">{hint}</p>}
    </div>
  );
}

/** Loading: a real ongoing state, drawn as a broadcast loading strip. */
export function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-24">
      <div className="relative h-1 w-40 overflow-hidden bg-[var(--hr-surface-2)]">
        <span className="absolute inset-y-0 left-0 w-1/3 bg-[var(--hr-orange)] animate-[hr-loading_900ms_var(--hr-ease-out)_infinite]" />
      </div>
      <style>{"@keyframes hr-loading{from{transform:translateX(-100%)}to{transform:translateX(300%)}}"}</style>
    </div>
  );
}

/** Nothing here yet. `stage` adds the 3D stage (only on screens where nobody is mid-task). */
/** `stage`: true for the neutral blocks, or the viewer's real steps (decision D3). */
export function Empty({ title, body, children, stage }: { title: string; body?: ReactNode; children?: ReactNode; stage?: boolean | StageStep[] }) {
  return (
    <div className={cn("bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] px-6 py-10 text-center",
      stage && "grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 text-left py-6")}>
      {stage && <Stage steps={Array.isArray(stage) ? stage : undefined} className="h-56 md:h-64 order-last md:order-first" />}
      <div>
        <p className="hr-display text-xl">{title}</p>
        {body && <p className={cn("text-sm text-[var(--hr-muted)] mt-2 max-w-md", !stage && "mx-auto")}>{body}</p>}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}

/** The org's credit balance for the top bar, in the data face (plain: gold is reserved for overall/completed). */
export function CreditsTag({ value }: { value: number | string | null | undefined }) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title="Credits left for this organisation">
      <span className="hr-data text-sm text-foreground">{Number.isFinite(n) ? n.toLocaleString("en-IN") : value}</span>
      <span className="hr-label !text-[10px]">credits</span>
    </span>
  );
}
