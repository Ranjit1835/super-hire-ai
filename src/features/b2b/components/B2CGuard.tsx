// R3.2: B2B users never see B2C pricing, paywalls, upgrade prompts or checkout. A signed-in member of a college or
// company (student, TPO, trainer, recruiter...) who opens a B2C page is sent to their own portal instead. Super admins
// (HiResume team) and B2C users are unaffected, and with B2B off this renders its children untouched.
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { B2B_ENABLED } from "@/lib/config";
import { useIsSuperAdmin, useMyMemberships } from "../hooks/useB2B";
import type { MembershipWithOrg } from "../types";

/** Where a B2B member belongs: students to their drives, college staff to /c, company staff to /co. */
export function b2bHomeFor(memberships: Pick<MembershipWithOrg, "role" | "organizations">[]): string | null {
  if (!memberships.length) return null;
  if (memberships.some((m) => m.role === "student")) return "/learn/v1";
  const company = memberships.some((m) => m.organizations?.type === "company");
  return company ? "/co" : "/c";
}

export function B2CGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  if (!B2B_ENABLED || !user) return <>{children}</>;
  // Wait for the answer rather than flashing a B2C page (with prices) to a B2B member.
  if (memberships.isLoading || isSuper.isLoading) return null;
  if (isSuper.data) return <>{children}</>;
  const home = b2bHomeFor(memberships.data ?? []);
  return home ? <Navigate to={home} replace /> : <>{children}</>;
}
