// Who may stay signed in (owner decisions 2026-11-09): members of a deactivated organisation, and college students with
// no drive assigned, are signed out with a reason the sign-in page explains. The rule lives in SQL
// (b2b_access_check, 20261109000001_b2b_org_lifecycle.sql); this only asks after every sign-in and on each new account.
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { B2B_ENABLED } from "@/lib/config";
import { b2bDb } from "@/features/b2b/lib/db";
import { endServerSession } from "../session";

export type BlockReason = "NO_DRIVE" | "ORG_DEACTIVATED";

export const BLOCK_MESSAGE: Record<BlockReason, string> = {
  NO_DRIVE: "No drive has been assigned to you yet. Your placement office will let you know when one is ready, then you can sign in.",
  ORG_DEACTIVATED: "Your organisation's access to HiResume has been turned off. Please contact your placement office or HR team.",
};

export const isBlockReason = (v: string | null): v is BlockReason => v === "NO_DRIVE" || v === "ORG_DEACTIVATED";

/** Accepting an invite has to finish (consent, account) before the check means anything. */
const UNCHECKED = [/^\/invite\//, /^\/auth(\/|$)/, /^\/verify-otp/, /^\/reset-password/];

export function AccessGate() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const skip = UNCHECKED.some((re) => re.test(pathname));
  const check = useQuery({
    queryKey: ["b2b-access", user?.id],
    enabled: B2B_ENABLED && !!user && !skip,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("b2b_access_check");
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
  });
  const reason = check.data && !check.data.ok ? check.data.reason ?? null : null;

  useEffect(() => {
    if (!isBlockReason(reason)) return;
    void (async () => {
      await endServerSession();
      await signOut();
      navigate(`/auth?blocked=${reason}`, { replace: true });
    })();
  }, [reason, signOut, navigate]);

  return null;
}
