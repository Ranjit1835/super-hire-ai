// The login details of a staff account made at invite time, shown to the super admin only when the email with them
// couldn't be sent (email not set up yet). Shown once: it isn't stored anywhere the app can read again.
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function StaffLogin({ email, tempPassword, onDone }: { email: string; tempPassword: string; onDone?: () => void }) {
  const { toast } = useToast();
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text); toast({ title: `${what} copied` }); };
  return (
    <div role="status" className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-orange)] px-4 py-3 space-y-2">
      <p className="hr-label">Account created</p>
      <p className="text-sm">Email isn't set up yet, so send these to <b className="text-foreground">{email}</b> yourself. They're shown only now.
        They'll set their own password the first time they sign in at hiresume.in.</p>
      <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 items-center text-sm">
        <dt className="hr-label">Username</dt><dd className="hr-data truncate">{email}</dd>
        <Button size="sm" variant="outline" onClick={() => copy(email, "Username")}>Copy</Button>
        <dt className="hr-label">Temporary password</dt><dd className="hr-data">{tempPassword}</dd>
        <Button size="sm" variant="outline" onClick={() => copy(tempPassword, "Password")}>Copy</Button>
      </dl>
      {onDone && <Button size="sm" variant="ghost" onClick={onDone}>Done</Button>}
    </div>
  );
}
