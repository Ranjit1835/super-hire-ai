// Shared broadcast parts for the B2B app: logo, numerals, scorebug, stat strips, chips, player card.
// One world: live score graphics. Series colours carry one meaning each (see theme.css).
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT, NUMERAL_SPRING, useReducedMotion } from "../motion";

/** The HiResume mark: an H set in an angled scorebug tag. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 40 28" className={cn("h-7 w-10 shrink-0", className)} role={title ? "img" : undefined}
         aria-label={title} aria-hidden={title ? undefined : true}>
      <path d="M7 0H40L33 28H0Z" fill="var(--hr-orange, #FF5A0F)" />
      <path d="M12.5 6h4.2l-1.1 5.6h7l1.1-5.6h4.2l-3.2 16h-4.2l1.3-6.6h-7l-1.3 6.6H9.3Z" fill="#07090F" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="hr-display text-[17px] tracking-tight">HiResume</span>
    </span>
  );
}

export type Tone = "orange" | "blue" | "gold" | "red" | "muted" | "plain";
const TONE_TEXT: Record<Tone, string> = {
  orange: "text-[var(--hr-orange)]",
  blue: "text-[var(--hr-blue-ink)]",
  gold: "text-[var(--hr-gold)]",
  red: "text-[var(--hr-red-ink)]",
  muted: "text-[var(--hr-muted)]",
  plain: "text-foreground",
};
const TONE_FILL: Record<Exclude<Tone, "plain" | "muted">, string> = {
  orange: "var(--hr-orange)", blue: "var(--hr-blue)", gold: "var(--hr-gold)", red: "var(--hr-red)",
};

/**
 * A headline number that drives in (rise + settle on a firm spring) on first load and whenever it changes.
 * The text is always the final value: no counting through wrong numbers, nothing for screen readers to chase.
 */
export function Numeral({ value, className, tone = "plain" }: { value: number | string | null | undefined; className?: string; tone?: Tone }) {
  const reduced = useReducedMotion();
  const text = typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN") : (value ?? "–");
  const cls = cn("hr-numeral inline-block", TONE_TEXT[tone], className);
  if (reduced) return <span className={cls}>{text}</span>;
  return (
    <motion.span key={String(text)} className={cls} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                 transition={NUMERAL_SPRING}>
      {text}
    </motion.span>
  );
}

/**
 * One scorebug counter. Decision D2: counters are neutral; only `gold` (completed) and `red` (needs someone's action)
 * colour a numeral; any other tone renders plain. `live` adds the blue tally square for a live count. Decision D8:
 * `short` replaces the label on phones.
 */
export interface Counter { label: string; short?: string; value: number | string | null | undefined; tone?: Tone; hint?: string; live?: boolean }
const COUNTER_TONE = (t?: Tone): Tone => (t === "gold" || t === "red" ? t : "plain");

/**
 * The scorebug: the state of a drive, role or org at a glance. The only 2px colour frame on a working screen.
 * `head` holds the title block; counters sit in fixed cells to its right (wrapping under it on narrow screens).
 */
export function Scorebug({ head, counters, className }: { head: ReactNode; counters: Counter[]; className?: string }) {
  return (
    <section className={cn("hr-scorebug flex flex-col lg:flex-row", className)}>
      <div className="min-w-0 flex-1 px-5 py-4">{head}</div>
      {/* One row of counters at every width: on phones the numerals and labels shrink instead of wrapping into rows. */}
      <dl className="grid border-t-2 border-[var(--hr-blue)] lg:border-t-0" style={{ gridTemplateColumns: `repeat(${counters.length}, minmax(0, 1fr))` }}>
        {counters.map((c) => (
          <div key={c.label} className="px-1 sm:px-4 py-3 sm:min-w-[92px] text-center flex flex-col-reverse justify-center"
               style={{ boxShadow: "inset 1px 0 0 var(--hr-rule)" }} title={c.hint}>
            <dt className="hr-label hr-short mt-1.5 !text-[9px] sm:!text-[11px] !tracking-[0.04em] sm:!tracking-[0.1em] leading-tight whitespace-nowrap"
                data-short={c.short}>{c.label}</dt>
            <dd className="text-[24px] sm:text-[34px] leading-none inline-flex items-start justify-center gap-1">
              <Numeral value={c.value} tone={COUNTER_TONE(c.tone)} />
              {c.live && <span aria-hidden className="mt-1 h-1.5 w-1.5 bg-[var(--hr-blue)]" />}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type Series = "test" | "interview" | "overall";
const SERIES_TONE: Record<Series, Exclude<Tone, "plain" | "muted">> = { test: "orange", interview: "blue", overall: "gold" };

/** A thin bar on the one fixed 0-100 ramp, coloured by its series. `null` draws nothing (not yet scored). */
export function StatStrip({ value, series, max = 100, index = 0, label }: {
  value: number | null | undefined; series: Series; max?: number; index?: number; label?: string;
}) {
  const reduced = useReducedMotion();
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <span className="hr-strip inline-block align-middle" role="img" aria-label={label ?? `${series} ${value} of ${max}`}>
      <i style={{
        background: TONE_FILL[SERIES_TONE[series]], transform: `scaleX(${pct})`,
        animation: reduced ? undefined : `hr-strip-grow ${DUR.strip * 1000}ms var(--hr-ease-out) ${index * 30}ms both`,
      }} />
    </span>
  );
}

/** Small state chip: words always present, colour only where it means something. */
export function Chip({ tone = "muted", children, className, solid }: { tone?: Tone; children: ReactNode; className?: string; solid?: boolean }) {
  const fill = solid && tone !== "plain" && tone !== "muted" ? TONE_FILL[tone] : undefined;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap",
      // Text on a fill: dark on orange/gold, white on blue/red (dark there measures 4.1:1 and 4.4:1; white 4.8:1 and 4.6:1).
      fill ? (tone === "blue" || tone === "red" ? "text-white" : "text-[#07090F]") : cn(TONE_TEXT[tone], "shadow-[inset_0_0_0_1px_currentColor]"), className)}
      style={fill ? { background: fill } : undefined}>
      {children}
    </span>
  );
}

export interface PlayerStat { label: string; value: ReactNode; series?: Series; score?: number | null; max?: number }

/** The player card: one person's evidence summary, docked to the right of a table. */
export function PlayerCard({ open, name, code, meta, headline, stats, children, onClose, closeLabel = "Close" }: {
  open: boolean; name: string; code?: string; meta?: ReactNode;
  headline?: { label: string; value: number | string | null | undefined; tone?: Tone };
  stats: PlayerStat[]; children?: ReactNode; onClose?: () => void; closeLabel?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside key={code ?? name} aria-label={`${name} summary`}
          className="border-2 border-[var(--hr-orange)] bg-[var(--hr-surface)] flex flex-col"
          initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
          exit={reduced ? undefined : { opacity: 0, transition: { duration: DUR.exit, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: DUR.panel, ease: EASE_OUT }}>
          <div className="flex items-start gap-2 px-4 pt-4 pb-3 hr-rule-b">
            <div className="min-w-0 flex-1">
              <h3 className="hr-display text-2xl truncate">{name}</h3>
              <p className="hr-data text-xs text-[var(--hr-muted)] mt-1">{[code, meta].filter(Boolean).map((x, i) => <span key={i}>{i ? " · " : ""}{x}</span>)}</p>
            </div>
            {onClose && (
              <button type="button" onClick={onClose} aria-label={closeLabel} className="p-1 text-[var(--hr-muted)] hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {headline && (
            <div className="px-4 py-3 hr-rule-b">
              <p className="hr-label">{headline.label}</p>
              <p className="text-[56px] leading-none mt-1"><Numeral value={headline.value} tone={headline.tone ?? "gold"} /></p>
            </div>
          )}
          <dl>
            {stats.map((s, i) => (
              <div key={s.label} className="grid grid-cols-[1fr_auto_72px] items-center gap-3 px-4 py-2.5 hr-rule-b">
                <dt className="hr-label">{s.label}</dt>
                <dd className="hr-data text-sm text-right">{s.value}</dd>
                <dd>{s.series ? <StatStrip value={s.score ?? null} series={s.series} max={s.max} index={i} /> : null}</dd>
              </div>
            ))}
          </dl>
          {children && <div className="px-4 py-3 text-sm flex-1">{children}</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
