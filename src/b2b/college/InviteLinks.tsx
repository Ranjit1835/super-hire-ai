import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadCsvFile, fileStamp } from "./lib/exports";

// Fields optional so zod outputs fit under both the strict and the non-strict tsconfig.
export interface InviteLinkRow { studentId?: string; link?: string; rollNo?: string; fullName?: string; email?: string }

/** Up to this many links are listed with a Copy button (a resend, a handful of students); more go to the CSV only. */
const LIST_MAX = 10;

/** After invites: how many were emailed, and the links (copy each, or a CSV for WhatsApp / when email isn't set up). */
export function InviteLinks({ links, emailed }: { links: InviteLinkRow[]; emailed: number }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!links.length) return <p className="text-sm">No invites were needed.</p>;
  const download = () => downloadCsvFile(`activation-links-${fileStamp()}.csv`, ["Roll no", "Name", "Email", "Activation link"],
    links.map((l) => [l.rollNo ?? "", l.fullName ?? "", l.email ?? "", l.link ?? ""]));
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm space-y-2">
      <p>
        {links.length} activation links created.{" "}
        {emailed > 0 ? `${emailed} sent by email.` : "Email isn't set up yet, so share the links yourself (WhatsApp or your college email)."}
      </p>
      {links.length <= LIST_MAX && (
        <ul className="space-y-1">
          {links.filter((l) => l.link).map((l) => (
            <li key={l.link} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate">{l.fullName ?? l.email}{l.rollNo ? ` (${l.rollNo})` : ""}</span>
              <Button size="sm" variant="ghost" aria-label={`Copy link for ${l.fullName ?? l.email}`}
                      onClick={() => { void navigator.clipboard?.writeText(l.link!).catch(() => {}); setCopied(l.link!); }}>
                {copied === l.link ? "Copied" : "Copy link"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" onClick={download}>Download links (CSV)</Button>
    </div>
  );
}
