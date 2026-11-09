import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { V1Shell, Loading, Empty, Stat } from "../layout/V1Shell";
import { ADMIN_TABS } from "./AdminOrgsPage";
import { ORG_TYPE_LABEL, friendly, inr, num, useCostBreakdown, useIsSuperAdmin, useOrgUsage, type CostGroup } from "./queries";

/** Per organisation: seats and people, credits used this month, AI calls, cost and cache savings. */
export default function AdminUsagePage() {
  const isSuper = useIsSuperAdmin();
  const enabled = isSuper.data === true;
  const usage = useOrgUsage(enabled);
  if (isSuper.isLoading) return <V1Shell title="Usage"><Loading /></V1Shell>;
  if (!enabled) return <Navigate to="/dashboard" replace />;
  const rows = usage.data ?? [];
  const totalCost = rows.reduce((s, r) => s + r.ai_cost_inr_month, 0);
  const calls = rows.reduce((s, r) => s + r.ai_calls_month, 0);
  const hits = rows.reduce((s, r) => s + r.cache_hits_month, 0);
  return (
    <V1Shell title="Usage" subtitle="This month (IST) unless marked" tabs={ADMIN_TABS}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Organisations" value={rows.length} />
        <Stat label="AI cost this month" value={<span className="hr-data">{inr(totalCost)}</span>} />
        <Stat label="AI calls this month" value={calls} />
        <Stat label="Served from cache" value={calls ? `${Math.round((hits / calls) * 100)}%` : "–"} hint={`${hits} calls with no model cost`} />
      </div>
      {usage.isLoading ? <Loading /> : usage.error ? <Empty title="Couldn't load usage" body={friendly(usage.error)} /> : !rows.length ? (
        <Empty title="No usage yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">Organisation</TableHead><TableHead className="hr-label text-right">Students / candidates</TableHead>
              <TableHead className="hr-label text-right">Staff</TableHead><TableHead className="hr-label text-right">Credits left</TableHead>
              <TableHead className="hr-label text-right">Credits used</TableHead><TableHead className="hr-label text-right">AI calls</TableHead>
              <TableHead className="hr-label text-right">Cache hit</TableHead><TableHead className="hr-label text-right">AI cost</TableHead>
              <TableHead className="hr-label text-right">AI cost (all time)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.org_id}>
                <TableCell className="py-2.5"><div className="font-medium">{r.org_name}</div>
                  <div className="text-xs text-[var(--hr-muted)]">{ORG_TYPE_LABEL[r.org_type] ?? r.org_type} · {r.plan_id}{r.status === "suspended" ? " · suspended" : ""}</div></TableCell>
                <TableCell className="py-2.5 text-right">
                  <span className="hr-data text-sm">{r.org_type === "company" ? r.candidates : `${r.students_active} / ${r.students}`}</span>
                </TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{r.members}</span></TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{r.credits_balance}</span></TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{r.credits_used_month}</span></TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{r.ai_calls_month}</span></TableCell>
                <TableCell className="py-2.5 text-right">
                  {r.cache_hit_rate_month === null ? <span className="text-[var(--hr-muted)]">–</span> : (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className="hr-data text-sm">{Math.round(r.cache_hit_rate_month * 100)}%</span>
                      <span className="hr-strip inline-block align-middle" role="img"
                        aria-label={`Cache hit ${Math.round(r.cache_hit_rate_month * 100)}%`}>
                        <i style={{ background: "var(--hr-muted)", transform: `scaleX(${Math.max(0, Math.min(1, r.cache_hit_rate_month))})` }} />
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{inr(r.ai_cost_inr_month)}</span></TableCell>
                <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{inr(r.ai_cost_inr_total)}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-[var(--hr-muted)] mt-3">Students column: activated / imported.</p>
      <CostBreakdown enabled={enabled} />
    </V1Shell>
  );
}

const GROUPS: { key: CostGroup; label: string }[] = [
  { key: "org", label: "By college" }, { key: "student", label: "By student" }, { key: "feature", label: "By feature" }, { key: "day", label: "By day" },
];

/** R6.1: where the AI money goes, per college, student, feature or day (IST), from the gateway's call log. */
function CostBreakdown({ enabled }: { enabled: boolean }) {
  const [by, setBy] = useState<CostGroup>("org");
  const [days, setDays] = useState(30);
  const q = useCostBreakdown(by, days, enabled);
  const rows = q.data ?? [];
  return (
    <section className="mt-8 space-y-3" aria-label="AI cost breakdown">
      <div className="flex flex-wrap items-end justify-between gap-2 hr-rule-b">
        <div role="tablist" aria-label="Group cost" className="flex">
          {GROUPS.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={by === g.key} onClick={() => setBy(g.key)}
                    className={`px-3 py-2 text-sm ${by === g.key ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)]"}`}>
              {g.label}
            </button>
          ))}
        </div>
        <label className="text-sm text-[var(--hr-muted)] pb-1.5">
          Period{" "}
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-transparent text-foreground">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <Empty title="Couldn't load costs" body={friendly(q.error)} /> : !rows.length ? (
        <Empty title="No AI usage in this period" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">{GROUPS.find((g) => g.key === by)!.label.replace("By ", "")}</TableHead>
              <TableHead className="hr-label text-right">Calls</TableHead>
              <TableHead className="hr-label text-right">Tokens in / out</TableHead>
              <TableHead className="hr-label text-right">Cached input</TableHead>
              <TableHead className="hr-label text-right">Speech</TableHead>
              <TableHead className="hr-label text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${by}-${r.key ?? "none"}`}>
                <TableCell>{r.label}{r.org_name && <span className="text-xs text-[var(--hr-muted)]"> · {r.org_name}</span>}</TableCell>
                <TableCell className="hr-data text-right">{r.calls}</TableCell>
                <TableCell className="hr-data text-right">{num(r.input_tokens).toLocaleString("en-IN")} / {num(r.output_tokens).toLocaleString("en-IN")}</TableCell>
                <TableCell className="hr-data text-right">{num(r.cached_input_tokens).toLocaleString("en-IN")}</TableCell>
                <TableCell className="hr-data text-right text-xs">{num(r.stt_seconds) ? `${Math.round(num(r.stt_seconds) / 60)} min STT` : ""}{num(r.tts_chars) ? ` ${num(r.tts_chars).toLocaleString("en-IN")} TTS chars` : ""}{!num(r.stt_seconds) && !num(r.tts_chars) ? "–" : ""}</TableCell>
                <TableCell className="hr-data text-right">{inr(num(r.cost_inr))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
