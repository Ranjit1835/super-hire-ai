import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Mail, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { B2BShell, CenteredSpinner, EmptyState } from "../components/B2BShell";
import { useIsSuperAdmin } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { friendlyDbError } from "../lib/format";
import { downloadCsv, toCsv } from "../lib/csv-export";

export const ENQUIRY_STATUSES = ["new", "contacted", "demo_scheduled", "pilot", "won", "lost", "spam"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New", contacted: "Contacted", demo_scheduled: "Demo scheduled", pilot: "Pilot", won: "Won", lost: "Lost", spam: "Spam",
};
const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: "bg-violet-500/15 text-violet-200 border-violet-500/30",
  contacted: "bg-sky-500/15 text-sky-200 border-sky-500/30",
  demo_scheduled: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  pilot: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  won: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  lost: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  spam: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export interface Enquiry {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  role: string;
  institution: string;
  email: string;
  phone: string | null;
  students: string | null;
  message: string | null;
  source: string | null;
  status: EnquiryStatus;
  notes: string | null;
}

const COLUMNS = "id, created_at, updated_at, name, role, institution, email, phone, students, message, source, status, notes";

function useEnquiries(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "enquiries"],
    enabled,
    queryFn: async () => {
      const { data, error } = await b2bDb.from("institution_enquiries").select(COLUMNS).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as Enquiry[];
    },
  });
}

/** Count of untriaged enquiries, for the admin header link. */
export function useNewEnquiryCount(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "enquiries", "new-count"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("super_new_enquiry_count");
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function EnquiryCard({ e, onSaved }: { e: Enquiry; onSaved: () => void }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(e.notes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = notes !== (e.notes ?? "");

  const save = async (patch: Partial<Pick<Enquiry, "status" | "notes">>) => {
    setSaving(true);
    const { error } = await b2bDb.from("institution_enquiries").update(patch).eq("id", e.id);
    setSaving(false);
    if (error) return toast({ title: "Couldn't save", description: friendlyDbError(error), variant: "destructive" });
    onSaved();
  };

  return (
    <li className="rounded-xl border border-border/60 p-4 space-y-3" data-testid="enquiry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold truncate">{e.institution}</p>
          <p className="text-sm text-muted-foreground">{e.name} · {e.role}{e.students ? ` · ${e.students} students` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-xs", STATUS_TONE[e.status])}>{STATUS_LABEL[e.status]}</Badge>
          <time className="text-xs text-muted-foreground" dateTime={e.created_at}>{fmtDate(e.created_at)}</time>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`mailto:${e.email}?subject=${encodeURIComponent(`HiResume for ${e.institution}`)}`} className="inline-flex items-center gap-1 text-primary hover:underline break-all">
          <Mail className="h-3.5 w-3.5 shrink-0" /> {e.email}
        </a>
        {e.phone && (
          <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Phone className="h-3.5 w-3.5" /> {e.phone}
          </a>
        )}
      </div>

      {e.message && <p className="text-sm text-muted-foreground whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3">{e.message}</p>}

      <div className="grid sm:grid-cols-[180px_1fr] gap-3 items-start">
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">Status</span>
          <select
            aria-label={`Status for ${e.institution}`}
            value={e.status}
            disabled={saving}
            onChange={(ev) => save({ status: ev.target.value as EnquiryStatus })}
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <div className="space-y-1">
          <label htmlFor={`notes-${e.id}`} className="text-xs text-muted-foreground block">Notes</label>
          <Textarea id={`notes-${e.id}`} rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Call notes, next step, decision maker…" />
          {dirty && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save({ notes: notes.trim() || null })} disabled={saving}>Save notes</Button>
              <Button size="sm" variant="ghost" onClick={() => setNotes(e.notes ?? "")} disabled={saving}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** /admin/enquiries — institution enquiries from /college-placement. Super-admin only. */
export default function SuperAdminEnquiries() {
  const isSuper = useIsSuperAdmin();
  const q = useEnquiries(isSuper.data === true);
  const qc = useQueryClient();
  const [status, setStatus] = useState<EnquiryStatus | "open" | "all">("open");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, open: 0 };
    for (const e of q.data ?? []) {
      c.all++; c[e.status] = (c[e.status] ?? 0) + 1;
      if (!["won", "lost", "spam"].includes(e.status)) c.open++;
    }
    return c;
  }, [q.data]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((e) =>
      (status === "all" || (status === "open" ? !["won", "lost", "spam"].includes(e.status) : e.status === status)) &&
      (!term || [e.institution, e.name, e.email, e.phone ?? "", e.role].some((v) => v.toLowerCase().includes(term))),
    );
  }, [q.data, status, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "enquiries"] });

  const exportCsv = () => {
    const csv = toCsv(
      ["Received", "Institution", "Name", "Role", "Email", "Phone", "Students", "Status", "Notes", "Message"],
      shown.map((e) => [e.created_at, e.institution, e.name, e.role, e.email, e.phone, e.students, STATUS_LABEL[e.status], e.notes, e.message]),
    );
    downloadCsv(`hiresume-enquiries-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  if (isSuper.isLoading) return <CenteredSpinner />;
  if (!isSuper.data) return <Navigate to="/dashboard" replace />;

  const tabs: Array<[typeof status, string]> = [["open", "Open"], ...ENQUIRY_STATUSES.map((s) => [s, STATUS_LABEL[s]] as [EnquiryStatus, string]), ["all", "All"]];

  return (
    <B2BShell
      title="Enquiries"
      subtitle="Super-admin · Institutions that asked about HiResume"
      actions={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="h-4 w-4 mr-1" /> CSV</Button>}
    >
      <div className="space-y-5">
        <Link to="/admin/orgs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Institutions
        </Link>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Filter by status">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={status === key}
                onClick={() => setStatus(key)}
                className={cn("shrink-0 rounded-full px-3 py-1 text-xs border transition-colors",
                  status === key ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:text-foreground")}
              >
                {label} <span className="opacity-70">{counts[key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden />
            <Input aria-label="Search enquiries" placeholder="Search institution, name, email" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </div>

        {q.isLoading ? <CenteredSpinner /> : q.error ? (
          <EmptyState title="Couldn't load enquiries" body={friendlyDbError(q.error)} />
        ) : !q.data?.length ? (
          <EmptyState title="No enquiries yet" body="Enquiries from the college placement page will appear here." />
        ) : !shown.length ? (
          <EmptyState title="Nothing here" body="No enquiries match this filter." />
        ) : (
          <ul className="space-y-3">
            {shown.map((e) => <EnquiryCard key={`${e.id}-${e.updated_at}`} e={e} onSaved={refresh} />)}
          </ul>
        )}
      </div>
    </B2BShell>
  );
}
