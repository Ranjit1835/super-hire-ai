import { Button } from "@/components/ui/button";
import { downloadCsvFile, fileStamp } from "./lib/exports";

// Fields optional so zod outputs fit under both the strict and the non-strict tsconfig.
export interface InviteLinkRow { studentId?: string; link?: string; rollNo?: string; fullName?: string; email?: string }

/** After invites: how many were emailed, and the links as a CSV (for WhatsApp / when email isn't set up). */
export function InviteLinks({ links, emailed }: { links: InviteLinkRow[]; emailed: number }) {
  if (!links.length) return <p className="text-sm">No invites were needed.</p>;
  const download = () => downloadCsvFile(`activation-links-${fileStamp()}.csv`, ["Roll no", "Name", "Email", "Activation link"],
    links.map((l) => [l.rollNo ?? "", l.fullName ?? "", l.email ?? "", l.link ?? ""]));
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm space-y-2">
      <p>
        {links.length} activation links created.{" "}
        {emailed > 0 ? `${emailed} sent by email.` : "Email isn't set up yet, so share the links yourself (WhatsApp or your college email)."}
      </p>
      <Button size="sm" variant="outline" onClick={download}>Download links (CSV)</Button>
    </div>
  );
}
