import type { InvitePreview } from "./api";
const STAFF_ROLES = ["org_admin", "trainer", "recruiter", "hiring_manager"];

/** Where an accepted invite leads: V1 staff to their portal, V1 college students to /learn/v1, pilot students to /learn. */
export function afterJoin(p: Pick<InvitePreview, "role" | "org">): { to: string; label: string } {
  if (p.role && STAFF_ROLES.includes(p.role)) {
    return p.org.type === "company"
      ? { to: `/co/${p.org.id}`, label: "your hiring portal" }
      : { to: `/c/${p.org.id}`, label: "your placement portal" };
  }
  if (p.org.type === "college") return { to: "/learn/v1", label: "your drives" };
  return { to: "/learn", label: "your interview practice" };
}
