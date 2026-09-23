import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { B2BShell, CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { useIsSuperAdmin, usePlans } from "../hooks/useB2B";
import type { Plan } from "../types";
import { b2bDb } from "../lib/db";
import { friendlyDbError } from "../lib/format";

interface MonthRow {
  month: string; org_id: string; org_name: string; is_demo: boolean; interviews: number; llm_calls: number;
  input_tokens: number; output_tokens: number; stt_minutes: number; tts_chars: number; cost_inr: number; cost_per_interview: number | null;
}
interface RevenueRow {
  org_id: string; org_name: string; is_demo: boolean; plan_id: string; price_inr_per_student: number; students: number;
  revenue_inr: number; interviews: number; cost_inr: number; cost_per_interview: number | null; cost_per_student: number | null;
  margin_inr: number; cost_share: number | null;
}
interface PriceRow {
  id: string; provider_key: string; input_inr_per_million: number; output_inr_per_million: number; unit_inr: number;
  effective_from: string; notes: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const inr = (v: number | null, digits = 2) =>
  v === null ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const compact = (n: number) => n.toLocaleString("en-IN");

function useCosts(enabled: boolean, includeDemo: boolean) {
  return useQuery({
    queryKey: ["b2b", "costs", includeDemo],
    enabled,
    queryFn: async () => {
      const [m, r, p] = await Promise.all([
        b2bDb.rpc("super_cost_by_org_month", { _include_demo: includeDemo }),
        b2bDb.rpc("super_cost_vs_revenue", { _include_demo: includeDemo }),
        b2bDb.from("b2b_pricing").select("*").order("effective_from", { ascending: false }),
      ]);
      for (const x of [m, r, p]) if (x.error) throw x.error;
      const months = (m.data as Record<string, unknown>[]).map((x) => ({
        ...x, interviews: Number(x.interviews), llm_calls: Number(x.llm_calls), input_tokens: Number(x.input_tokens),
        output_tokens: Number(x.output_tokens), stt_minutes: Number(x.stt_minutes), tts_chars: Number(x.tts_chars),
        cost_inr: Number(x.cost_inr), cost_per_interview: num(x.cost_per_interview),
      })) as MonthRow[];
      const revenue = (r.data as Record<string, unknown>[]).map((x) => ({
        ...x, price_inr_per_student: Number(x.price_inr_per_student), students: Number(x.students), revenue_inr: Number(x.revenue_inr),
        interviews: Number(x.interviews), cost_inr: Number(x.cost_inr), cost_per_interview: num(x.cost_per_interview),
        cost_per_student: num(x.cost_per_student), margin_inr: Number(x.margin_inr), cost_share: num(x.cost_share),
      })) as RevenueRow[];
      const pricing = (p.data as Record<string, unknown>[]).map((x) => ({
        ...x, input_inr_per_million: Number(x.input_inr_per_million), output_inr_per_million: Number(x.output_inr_per_million), unit_inr: Number(x.unit_inr),
      })) as PriceRow[];
      return { months, revenue, pricing };
    },
  });
}

/** /admin/costs — super-admin only. */
export default function SuperAdminCosts() {
  const isSuper = useIsSuperAdmin();
  const [includeDemo, setIncludeDemo] = useState(false);
  const q = useCosts(isSuper.data === true, includeDemo);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [recomputing, setRecomputing] = useState(false);

  const totals = useMemo(() => {
    const rows = q.data?.months ?? [];
    const cost = rows.reduce((a, r) => a + r.cost_inr, 0);
    const interviews = (q.data?.revenue ?? []).reduce((a, r) => a + r.interviews, 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    return {
      cost, interviews,
      perInterview: interviews ? cost / interviews : null,
      monthCost: rows.filter((r) => r.month.slice(0, 7) === thisMonth).reduce((a, r) => a + r.cost_inr, 0),
      tokens: rows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0),
      sttMinutes: rows.reduce((a, r) => a + r.stt_minutes, 0),
    };
  }, [q.data]);

  const recompute = async () => {
    setRecomputing(true);
    const { data, error } = await b2bDb.rpc("super_recompute_costs");
    setRecomputing(false);
    if (error) return toast({ title: "Recalculation failed", description: friendlyDbError(error), variant: "destructive" });
    toast({ title: "Costs recalculated", description: `${data} usage events re-priced with the current rates.` });
    qc.invalidateQueries({ queryKey: ["b2b", "costs"] });
  };

  if (isSuper.isLoading) return <CenteredSpinner />;
  if (!isSuper.data) return <Navigate to="/dashboard" replace />;

  return (
    <B2BShell
      title="Costs"
      subtitle="Super-admin · AI and speech usage across institutions"
      actions={
        <div className="flex items-center gap-2 mr-2">
          <Switch id="incl-demo" checked={includeDemo} onCheckedChange={setIncludeDemo} />
          <Label htmlFor="incl-demo" className="text-xs font-normal">Include demo orgs</Label>
        </div>
      }
    >
      <div className="space-y-8">
        <Link to="/admin/orgs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Institutions
        </Link>

        {q.isLoading ? <CenteredSpinner /> : q.error ? <EmptyState title="Couldn't load costs" body={friendlyDbError(q.error)} /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Average cost per interview" value={inr(totals.perInterview)} hint={`${compact(totals.interviews)} interviews, incl. evaluation`} />
              <StatCard label="This month" value={inr(totals.monthCost)} />
              <StatCard label="All time" value={inr(totals.cost)} hint={`${compact(totals.tokens)} tokens`} />
              <StatCard label="Speech recognised" value={`${compact(Math.round(totals.sttMinutes))} min`} hint="Browser speech: no charge unless a paid provider is priced" />
            </div>

            <section>
              <h2 className="font-semibold mb-2">Cost vs plan revenue</h2>
              <p className="text-xs text-muted-foreground mb-2">Revenue = students enrolled × the plan's price per student (set it on the plan). Cost is to date.</p>
              {!q.data?.revenue.length ? <EmptyState title="No institutions yet" /> : (
                <div className="rounded-lg border border-border/60 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Institution</TableHead><TableHead>Plan</TableHead>
                        <TableHead className="text-right">Students</TableHead><TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Interviews</TableHead><TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Per interview</TableHead><TableHead className="text-right">Per student</TableHead>
                        <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Cost share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {q.data.revenue.map((r) => (
                        <TableRow key={r.org_id}>
                          <TableCell>{r.org_name}{r.is_demo && <span className="text-xs text-amber-300 ml-1">demo</span>}</TableCell>
                          <TableCell className="text-muted-foreground">{r.plan_id} · {inr(r.price_inr_per_student, 0)}/student</TableCell>
                          <TableCell className="text-right tabular-nums">{r.students}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.revenue_inr, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.interviews}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.cost_inr)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.cost_per_interview)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.cost_per_student)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.margin_inr < 0 && "text-red-300")}>{inr(r.margin_inr, 0)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.cost_share !== null && r.cost_share > 0.3 && "text-amber-300")}>
                            {r.cost_share === null ? (r.revenue_inr === 0 ? "no price set" : "—") : `${(r.cost_share * 100).toFixed(1)}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section>
              <h2 className="font-semibold mb-2">By institution and month (IST)</h2>
              {!q.data?.months.length ? <EmptyState title="No usage logged yet" body="Costs appear as soon as students take interviews." /> : (
                <div className="rounded-lg border border-border/60 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead><TableHead>Institution</TableHead>
                        <TableHead className="text-right">Interviews</TableHead><TableHead className="text-right">AI calls</TableHead>
                        <TableHead className="text-right">Tokens in / out</TableHead><TableHead className="text-right">Speech min</TableHead>
                        <TableHead className="text-right">TTS chars</TableHead><TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Per interview</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {q.data.months.map((r) => (
                        <TableRow key={`${r.month}-${r.org_id}`}>
                          <TableCell className="whitespace-nowrap">{new Date(r.month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</TableCell>
                          <TableCell>{r.org_name}{r.is_demo && <span className="text-xs text-amber-300 ml-1">demo</span>}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.interviews}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(r.llm_calls)}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(r.input_tokens)} / {compact(r.output_tokens)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.stt_minutes}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(r.tts_chars)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.cost_inr)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(r.cost_per_interview)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <PlanPrices onChanged={() => qc.invalidateQueries({ queryKey: ["b2b"] })} />
            <PricingEditor rows={q.data!.pricing} onChanged={() => qc.invalidateQueries({ queryKey: ["b2b", "costs"] })} />
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={recompute} disabled={recomputing}>
                {recomputing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Recalculate all costs with current rates
              </Button>
              <p className="text-xs text-muted-foreground">Logged costs keep the rate at the time they happened until you recalculate.</p>
            </div>
          </>
        )}
      </div>
    </B2BShell>
  );
}

function PlanPrices({ onChanged }: { onChanged: () => void }) {
  const plans = usePlans(true);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = async (p: Plan) => {
    const v = Number(draft[p.id]);
    if (!Number.isFinite(v) || v < 0) return toast({ title: "Enter a price of ₹0 or more", variant: "destructive" });
    const { error } = await b2bDb.from("plans").update({ price_inr_per_student: v }).eq("id", p.id);
    if (error) return toast({ title: "Couldn't save price", description: friendlyDbError(error), variant: "destructive" });
    toast({ title: `${p.name}: ₹${v} per student` });
    setDraft((d) => ({ ...d, [p.id]: "" }));
    onChanged();
  };
  return (
    <section>
      <h2 className="font-semibold mb-1">Plan prices (for revenue)</h2>
      <p className="text-xs text-muted-foreground mb-2">Price per student for the whole plan period. No billing is connected; this only feeds the revenue estimate.</p>
      <div className="flex flex-wrap gap-3">
        {(plans.data ?? []).map((p) => (
          <div key={p.id} className="rounded-lg border border-border/60 p-3 flex items-end gap-2">
            <div>
              <Label htmlFor={`price-${p.id}`} className="text-xs">{p.name} · now ₹{p.price_inr_per_student ?? 0}</Label>
              <Input id={`price-${p.id}`} className="w-28" inputMode="decimal" placeholder="₹ / student"
                value={draft[p.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
            </div>
            <Button size="sm" variant="secondary" disabled={!draft[p.id]} onClick={() => save(p)}>Save</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingEditor({ rows, onChanged }: { rows: PriceRow[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const current = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.provider_key) ? false : (seen.add(r.provider_key), true)));
  }, [rows]);

  const add = async () => {
    if (!key.trim()) return;
    setSaving(true);
    const { error } = await b2bDb.from("b2b_pricing").insert({
      provider_key: key.trim(), input_inr_per_million: Number(input) || 0, output_inr_per_million: Number(output) || 0,
      unit_inr: Number(unit) || 0, notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast({ title: "Couldn't save rate", description: friendlyDbError(error), variant: "destructive" });
    toast({ title: "Rate saved", description: "Applies to new usage now. Recalculate to re-price past usage." });
    setKey(""); setInput(""); setOutput(""); setUnit(""); setNotes("");
    onChanged();
  };

  return (
    <section>
      <h2 className="font-semibold mb-1">Rates</h2>
      <p className="text-xs text-muted-foreground mb-2">
        The seeded LLM rate is a <strong>placeholder</strong> derived from Gemini 2.5 Flash list prices — replace it with your actual per-model rates.
        Keys: an exact model name, a pattern like <code>gemini-%</code>, or <code>%</code> for any model; <code>stt:browser</code> / <code>tts:browser</code> for speech (₹/minute and ₹/million characters).
      </p>
      <div className="rounded-lg border border-border/60 overflow-x-auto mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead><TableHead className="text-right">₹ / 1M input tokens</TableHead>
              <TableHead className="text-right">₹ / 1M output tokens</TableHead><TableHead className="text-right">₹ / unit</TableHead>
              <TableHead>Since</TableHead><TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.provider_key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.input_inr_per_million}</TableCell>
                <TableCell className="text-right tabular-nums">{r.output_inr_per_million}</TableCell>
                <TableCell className="text-right tabular-nums">{r.unit_inr}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.effective_from).toLocaleDateString("en-IN")}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.notes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid sm:grid-cols-[1.4fr,1fr,1fr,1fr,2fr,auto] gap-2 items-end">
        <div><Label htmlFor="p-key" className="text-xs">Key</Label><Input id="p-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="gemini-3.6-flash" /></div>
        <div><Label htmlFor="p-in" className="text-xs">Input ₹/1M</Label><Input id="p-in" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} /></div>
        <div><Label htmlFor="p-out" className="text-xs">Output ₹/1M</Label><Input id="p-out" inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} /></div>
        <div><Label htmlFor="p-unit" className="text-xs">Unit ₹</Label><Input id="p-unit" inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
        <div><Label htmlFor="p-notes" className="text-xs">Notes</Label><Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="From Sept invoice" /></div>
        <Button onClick={add} disabled={saving || !key.trim()}><Plus className="h-4 w-4 mr-1" /> Add rate</Button>
      </div>
    </section>
  );
}
