-- "Read job roles" used can_view_job_role(id), a STABLE function that looks the role up by id. During
-- INSERT ... RETURNING (what the role form sends) the new row isn't visible to that lookup, so the SELECT check
-- failed and recruiters and company admins could never create a role from the UI ("You don't have permission").
-- Check the row's own columns instead; same rule as can_view_job_role, which other policies keep using for
-- existing roles.

DROP POLICY IF EXISTS "Read job roles" ON public.job_roles;
CREATE POLICY "Read job roles" ON public.job_roles FOR SELECT TO authenticated USING (
  public.is_super_admin()
  OR public.org_role_of(org_id) IN ('org_admin', 'recruiter')
  OR (public.org_role_of(org_id) = 'hiring_manager' AND auth.uid() = ANY (hiring_manager_ids))
);
