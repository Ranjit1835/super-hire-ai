import type { ShellTab } from "../layout/V1Shell";

/** The super admin's sections. Every super admin screen shows these, so nothing needs a typed URL. */
export const ADMIN_TABS: ShellTab[] = [
  { to: "/admin/orgs", label: "Organisations" },
  { to: "/assess/bank/global", label: "Global question bank" },
  { to: "/admin/usage", label: "Usage" },
  { to: "/admin/costs", label: "AI costs" },
  { to: "/admin/enquiries", label: "Enquiries" },
];
