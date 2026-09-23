import { Link } from "react-router-dom";
import { Building2, ArrowRight } from "lucide-react";
import { useMyMemberships } from "../hooks/useB2B";

/** Shown on the B2C dashboard only for users who belong to an institution. Renders nothing otherwise. */
export function InstitutionBanner() {
  const { data } = useMyMemberships();
  const staff = data?.find((m) => m.role !== "student");
  const student = data?.find((m) => m.role === "student");
  const m = staff ?? student;
  if (!m) return null;
  const to = staff ? `/org/${staff.org_id}` : "/learn";
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 mb-6 hover:bg-violet-500/15 transition-colors"
    >
      <Building2 className="h-5 w-5 text-violet-300 shrink-0" />
      <span className="text-sm flex-1">
        {staff ? "Open the institution dashboard for " : "Your interview practice with "}
        <strong>{m.organizations.name}</strong>
      </span>
      <ArrowRight className="h-4 w-4 text-violet-300" />
    </Link>
  );
}
