import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { EvaluationReport } from "../components/EvaluationReport";
import { useOrgContext } from "../components/OrgContext";
import { useOrgModules } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { downloadCsv, toCsv } from "../lib/csv-export";
import { formatDate, friendlyDbError } from "../lib/format";
import { READINESS_LABEL, READINESS_STYLE } from "../lib/report-style";
import type { EvaluationRow } from "../lib/api";

type LeadStatus = "new" | "contacted" | "enrolled" | "not_interested";
interface Lead {
  id: string; full_name: string; phone: string; email: string; target_course: string | null; module_id: string | null;
  interview_id: string | null; status: LeadStatus; overall_score: number | null; readiness_level: "not_ready" | "developing" | "ready" | null;
  primary_gap: string | null; created_at: string;
}
interface Settings { enabled: boolean; monthly_cap: number; used_this_month: number; cta_label: string | null; cta_url: string | null; slug: string }

const STATUS_LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", enrolled: "Enrolled", not_interested: "Not interested" };
const ALL = "__all";

/** /org/:orgId/leads — public readiness test settings + leads. */
export default function OrgLeads() {
  const { org, canManage } = useOrgContext();
  const qc = useQueryClient();
  const { toast } = useToast();
  const modules = useOrgModules(org.id);
  const settings = useQuery({
    queryKey: ["b2b", "public-test-settings", org.id],
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("org_public_test_usage", { _org_id: org.id });
      if (error) throw error;
      return data as Settings;
    },
  });
  const leads = useQuery({
    queryKey: ["b2b", "leads", org.id],
    queryFn: async () => {
      const { data, error } = await b2bDb.from("org_leads")
        .select("id, full_name, phone, email, target_course, module_id, interview_id, status, overall_score, readiness_level, primary_gap, created_at")
        .eq("org_id", org.id).order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return (data as Lead[]).map((l) => ({ ...l, overall_score: l.overall_score === null ? null : Number(l.overall_score) }));
    },
  });
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [reportFor, setReportFor] = useState<Lead | null>(null);
  const [draft, setDraft] = useState<{ label: string; url: string } | null>(null);

  const moduleName = useMemo(() => new Map((modules.data?.own ?? []).map((m) => [m.id, m.name])), [modules.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leads.data ?? []).filter((l) =>
      (status === ALL || l.status === status) &&
      (!q || [l.full_name, l.phone, l.email, l.target_course].some((v) => v?.toLowerCase().includes(q))));
  }, [leads.data, status, search]);

  const link = `${window.location.origin}/test/${org.slug}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ["b2b"] });

  const saveSettings = async (enabled: boolean, label: string | null, url: string | null) => {
    const { error } = await b2bDb.rpc("org_update_public_test_settings", { _org_id: org.id, _enabled: enabled, _cta_label: label, _cta_url: url });
    if (error) return toast({ title: "Couldn't save", description: /check/.test(error.message) ? "The enquiry link must start with https://, tel: or mailto:." : friendlyDbError(error), variant: "destructive" });
    toast({ title: "Saved" });
    setDraft(null);
    refresh();
  };
  const toggleModule = async (id: string, on: boolean) => {
    const { error } = await b2bDb.from("interview_modules").update({ public_test: on }).eq("id", id);
    if (error) return toast({ title: "Couldn't update module", description: friendlyDbError(error), variant: "destructive" });
    refresh();
  };
  const setLeadStatus = async (l: Lead, s: LeadStatus) => {
    const { error } = await b2bDb.from("org_leads").update({ status: s }).eq("id", l.id);
    if (error) return toast({ title: "Couldn't update", description: friendlyDbError(error), variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["b2b", "leads", org.id] });
  };
  const exportCsv = () => downloadCsv(`${org.slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    ["date", "name", "phone", "email", "course", "test", "score", "readiness", "main gap", "status"],
    rows.map((l) => [formatDate(l.created_at), l.full_name, l.phone, l.email, l.target_course, l.module_id ? moduleName.get(l.module_id) : "",
      l.overall_score, l.readiness_level ? READINESS_LABEL[l.readiness_level] : "", l.primary_gap, STATUS_LABEL[l.status]]),
  ));

  if (settings.isLoading || leads.isLoading) return <CenteredSpinner />;
  if (settings.error) return <EmptyState title="Couldn't load" body={friendlyDbError(settings.error)} />;
  const st = settings.data!;
  const d = draft ?? { label: st.cta_label ?? "", url: st.cta_url ?? "" };

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Free readiness test</h2>
            <p className="text-sm text-muted-foreground">Share this link on your website, Instagram or WhatsApp. Visitors take a short voice test and become leads.</p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Switch id="pt-enabled" checked={st.enabled} onCheckedChange={(v) => saveSettings(v, st.cta_label, st.cta_url)} />
              <Label htmlFor="pt-enabled" className="text-sm font-normal">{st.enabled ? "Open to the public" : "Closed"}</Label>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <code className="text-sm bg-white/5 rounded px-2 py-1 break-all">{link}</code>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast({ title: "Link copied" }))}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
          <Button size="sm" variant="ghost" asChild><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Preview</a></Button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <StatCard label="Tests this month" value={`${st.used_this_month} / ${st.monthly_cap}`} tone={st.used_this_month >= st.monthly_cap ? "warn" : undefined}
            hint={st.used_this_month >= st.monthly_cap ? "Cap reached — the page shows your enquiry button instead" : "Monthly cap set by HiResume"} />
          <StatCard label="Leads (all time)" value={(leads.data ?? []).length} />
          <StatCard label="Enrolled" value={(leads.data ?? []).filter((l) => l.status === "enrolled").length} tone="ok" />
        </div>

        {canManage && (
          <>
            <div>
              <p className="text-sm font-medium mb-2">Tests offered on the page (6 questions, up to 10 minutes each)</p>
              <div className="flex flex-wrap gap-2">
                {(modules.data?.own ?? []).filter((m) => m.is_active).map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 text-sm">
                    <Switch checked={m.public_test === true} onCheckedChange={(v) => toggleModule(m.id, v)} aria-label={`Offer ${m.name}`} />
                    {m.name}
                  </label>
                ))}
                {!(modules.data?.own ?? []).some((m) => m.is_active) && <p className="text-sm text-muted-foreground">Enable a module first (Modules tab).</p>}
              </div>
            </div>
            <div className="grid sm:grid-cols-[1fr,2fr,auto] gap-2 items-end">
              <div><Label htmlFor="cta-label" className="text-xs">Button text</Label><Input id="cta-label" value={d.label} maxLength={60} placeholder="Enquire about our course" onChange={(e) => setDraft({ ...d, label: e.target.value })} /></div>
              <div><Label htmlFor="cta-url" className="text-xs">Button link (https://, tel: or mailto:)</Label><Input id="cta-url" value={d.url} placeholder="https://wa.me/91XXXXXXXXXX" onChange={(e) => setDraft({ ...d, url: e.target.value })} /></div>
              <Button onClick={() => saveSettings(st.enabled, d.label, d.url)} disabled={!draft}>Save</Button>
            </div>
          </>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="font-semibold mr-auto">Leads</h2>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email, course" className="w-60" aria-label="Search leads" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
        </div>
        {!rows.length ? <EmptyState title={(leads.data ?? []).length ? "No leads match" : "No leads yet"} body="Leads appear here as soon as someone starts the test." /> : (
          <div className="rounded-lg border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Course / test</TableHead>
                  <TableHead>Result</TableHead><TableHead>Status</TableHead><TableHead className="w-10"><span className="sr-only">Report</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(l.created_at)}</TableCell>
                    <TableCell>{l.full_name}</TableCell>
                    <TableCell className="text-xs">
                      <a href={`tel:${l.phone}`} className="block hover:underline tabular-nums">{l.phone}</a>
                      <a href={`mailto:${l.email}`} className="block text-muted-foreground hover:underline">{l.email}</a>
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.target_course ?? "—"}
                      <div className="text-muted-foreground">{l.module_id ? moduleName.get(l.module_id) : ""}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.readiness_level ? (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-sm">{l.overall_score ?? "—"}</span>
                          <Badge variant="outline" className={READINESS_STYLE[l.readiness_level]}>{READINESS_LABEL[l.readiness_level]}</Badge>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">Pending / incomplete</span>}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select value={l.status} onValueChange={(v) => setLeadStatus(l, v as LeadStatus)}>
                          <SelectTrigger className="h-8 w-36" aria-label={`Status for ${l.full_name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : STATUS_LABEL[l.status]}
                    </TableCell>
                    <TableCell>
                      {l.readiness_level && l.interview_id && (
                        <Button size="icon" variant="ghost" onClick={() => setReportFor(l)} aria-label={`Report for ${l.full_name}`}><FileText className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {reportFor && <LeadReportDialog lead={reportFor} onClose={() => setReportFor(null)} />}
    </div>
  );
}

function LeadReportDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["b2b", "lead-report", lead.interview_id],
    queryFn: async () => {
      const [{ data: ev, error }, { data: iv }] = await Promise.all([
        b2bDb.from("b2b_latest_evaluations").select("result, audio_metrics").eq("interview_id", lead.interview_id!).maybeSingle(),
        b2bDb.from("b2b_interviews").select("module_spec").eq("id", lead.interview_id!).maybeSingle(),
      ]);
      if (error) throw error;
      return { ev: ev as Pick<EvaluationRow, "result" | "audio_metrics"> | null, pass: (iv?.module_spec as { pass_threshold?: number } | undefined)?.pass_threshold ?? 6 };
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{lead.full_name} · readiness report</DialogTitle></DialogHeader>
        {q.isLoading ? <CenteredSpinner /> : q.data?.ev?.result
          ? <EvaluationReport result={q.data.ev.result} metrics={q.data.ev.audio_metrics} passMark={q.data.pass} audience="staff" />
          : <p className="text-sm text-muted-foreground">No report available.</p>}
      </DialogContent>
    </Dialog>
  );
}
