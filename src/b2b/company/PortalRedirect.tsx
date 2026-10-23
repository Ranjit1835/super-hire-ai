// /portal/:orgId → the right portal for the org type (company → /co, college → /c). Used by the question bank's
// "Portal" tab, which doesn't know the org type.
import { Navigate, useParams } from "react-router-dom";
import { Loading } from "../layout/V1Shell";
import { useCompanyOrg } from "./queries";

export default function PortalRedirect() {
  const { orgId = "" } = useParams();
  const org = useCompanyOrg(orgId);
  if (org.isLoading) return <Loading />;
  return <Navigate to={org.data?.type === "company" ? `/co/${orgId}` : `/c/${orgId}`} replace />;
}
