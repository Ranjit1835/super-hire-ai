// Itemised consent: each purpose is accepted separately (not bundled).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CONSENT_VERSION, consentItems, type ConsentContext, type ConsentPurposeV1 } from "./consent";

export interface AcceptedConsent { purpose: ConsentPurposeV1; version: string; text: string }

export function ConsentStep({ ctx, onAccept, onDecline }: {
  ctx: ConsentContext;
  onAccept: (items: AcceptedConsent[]) => void;
  onDecline?: () => void;
}) {
  const items = consentItems(ctx);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const all = items.every((i) => checked[i.purpose]);
  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold">Before you start: what is captured and why</p>
        <p className="text-sm text-[var(--hr-muted)] mt-1">
          This {ctx.kind === "interview" ? "interview" : "test"} uses AI proctoring. Flags are evidence for a human reviewer
          at {ctx.orgName}. Nobody is failed on AI flags alone. Read and accept each item below separately.
        </p>
      </div>
      <ul className="space-y-2.5">
        {items.map((i) => (
          <li key={i.purpose} className={checked[i.purpose] ? "bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-blue)] p-3" : "bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3"}>
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={!!checked[i.purpose]} aria-label={`I agree: ${i.title}`}
                        onCheckedChange={(v) => setChecked((c) => ({ ...c, [i.purpose]: v === true }))} className="mt-0.5" />
              <span className="text-sm space-y-1 block">
                <span className="font-semibold block">{i.title}</span>
                {i.text.split("\n").slice(1).map((line) => <span key={line} className="block text-[var(--hr-muted)]">{line}</span>)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!all}
                onClick={() => onAccept(items.map((i) => ({ purpose: i.purpose, version: CONSENT_VERSION, text: i.text })))}>
          I agree, continue
        </Button>
        {onDecline && <Button type="button" variant="ghost" onClick={onDecline}>I don't agree</Button>}
      </div>
      <p className="hr-data text-xs text-[var(--hr-muted)]">Consent version {CONSENT_VERSION}. You can withdraw consent later; the test can't continue without it.</p>
    </div>
  );
}
