import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Lock, Pencil, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { CenteredSpinner, EmptyState } from "../components/B2BShell";
import { ModuleMeta } from "../components/ModuleMeta";
import { useOrgContext } from "../components/OrgContext";
import { useOrgModules, useOrgUsageSummary } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { friendlyDbError } from "../lib/format";
import { COMPANY_PACK_DISCLAIMER, MODULE_TYPE_LABEL, type ModuleType } from "../lib/shared";
import type { InterviewModule } from "../types";

const TYPE_ORDER: ModuleType[] = ["skill", "company_pack", "hr"];
const TYPE_BADGE: Record<ModuleType, string> = {
  skill: "border-sky-500/40 text-sky-300",
  company_pack: "border-violet-500/40 text-violet-300",
  hr: "border-emerald-500/40 text-emerald-300",
};

/** /org/:orgId/modules */
export default function OrgModules() {
  const { org, canManage } = useOrgContext();
  const { user } = useAuth();
  const q = useOrgModules(org.id);
  const usage = useOrgUsageSummary(org.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const packsAllowed = usage.data?.plan.company_packs_enabled ?? false;
  const enabledTemplateIds = useMemo(
    () => new Set((q.data?.own ?? []).filter((m) => m.is_active && m.template_id).map((m) => m.template_id!)),
    [q.data],
  );
  const own = (q.data?.own ?? []).filter((m) => showArchived || m.is_active);
  const archivedCount = (q.data?.own ?? []).filter((m) => !m.is_active).length;

  const refresh = () => qc.invalidateQueries({ queryKey: ["b2b"] });

  const enable = async (t: InterviewModule) => {
    setBusy(t.id);
    const { error } = await b2bDb.from("interview_modules").insert({
      org_id: org.id, spec: t.spec, template_id: t.id, created_by: user?.id,
    });
    setBusy(null);
    if (error) return toast({ title: "Couldn't enable module", description: friendlyDbError(error), variant: "destructive" });
    toast({ title: `${t.name} enabled`, description: "Students can now see it. You can edit your copy any time." });
    refresh();
  };

  const setActive = async (m: InterviewModule, active: boolean) => {
    setBusy(m.id);
    const { error } = await b2bDb.from("interview_modules").update({ is_active: active }).eq("id", m.id);
    setBusy(null);
    if (error) return toast({ title: "Couldn't update module", description: friendlyDbError(error), variant: "destructive" });
    toast({ title: active ? "Module restored" : "Module archived", description: active ? undefined : "Students no longer see it. Past results are kept." });
    refresh();
  };

  if (q.isLoading) return <CenteredSpinner />;
  if (q.error) return <EmptyState title="Couldn't load modules" body={friendlyDbError(q.error)} />;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold">Modules for your students</h2>
            <p className="text-sm text-muted-foreground">Each module is a voice interview scoped to its topics.</p>
          </div>
          <div className="flex items-center gap-4">
            {archivedCount > 0 && (
              <div className="flex items-center gap-2">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived" className="text-sm font-normal">Show archived ({archivedCount})</Label>
              </div>
            )}
            {canManage && (
              <Button asChild size="sm"><Link to={`/org/${org.id}/modules/new`}><Plus className="h-4 w-4 mr-1" /> New module</Link></Button>
            )}
          </div>
        </div>

        {own.length === 0 ? (
          <EmptyState
            title="No modules enabled yet"
            body={canManage ? "Enable modules from the library below, or create your own." : "Your institution admin hasn't enabled any modules yet."}
          />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {own.map((m) => (
              <article key={m.id} className={`rounded-lg border border-border/60 bg-card/40 p-4 flex flex-col gap-2 ${m.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-snug">{m.name}</h3>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${TYPE_BADGE[m.type]}`}>{MODULE_TYPE_LABEL[m.type]}</Badge>
                </div>
                <ModuleMeta m={m} />
                <p className="text-xs text-muted-foreground line-clamp-2">{m.spec.topics.join(" · ")}</p>
                {!m.is_active && <p className="text-xs text-amber-300">Archived — hidden from students</p>}
                {canManage && (
                  <div className="flex gap-1 mt-auto pt-2">
                    <Button variant="ghost" size="sm" asChild><Link to={`/org/${org.id}/modules/${m.id}`}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Link></Button>
                    {m.is_active ? (
                      <Button variant="ghost" size="sm" disabled={busy === m.id} onClick={() => setActive(m, false)}>
                        <Archive className="h-3.5 w-3.5 mr-1" /> Archive
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={busy === m.id} onClick={() => setActive(m, true)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold">HiResume module library</h2>
        <p className="text-sm text-muted-foreground mb-3">Ready-made modules. Enabling one adds an editable copy to your institution.</p>
        {TYPE_ORDER.map((type) => {
          const items = (q.data?.library ?? []).filter((m) => m.type === type);
          if (!items.length) return null;
          return (
            <div key={type} className="mb-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{MODULE_TYPE_LABEL[type]}</h3>
              {type === "company_pack" && (
                <p className="text-xs text-muted-foreground mb-2">{COMPANY_PACK_DISCLAIMER}</p>
              )}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((t) => {
                  const enabled = enabledTemplateIds.has(t.id);
                  const locked = type === "company_pack" && !packsAllowed;
                  return (
                    <article key={t.id} className="rounded-lg border border-border/60 p-4 flex flex-col gap-2">
                      <h4 className="font-medium leading-snug">{t.name}</h4>
                      <ModuleMeta m={t} />
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">{t.spec.topics.length} topics</summary>
                        <ul className="list-disc pl-4 mt-1 space-y-0.5">{t.spec.topics.map((x) => <li key={x}>{x}</li>)}</ul>
                      </details>
                      <div className="mt-auto pt-2">
                        {enabled ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Enabled</span>
                        ) : locked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Included in Pilot and Pro plans</span>
                        ) : canManage ? (
                          <Button size="sm" variant="secondary" disabled={busy === t.id} onClick={() => enable(t)}>Enable for students</Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
