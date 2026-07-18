-- Orbit: leaders can monitor every non-private project attached to their group.
-- Run this after 202607170014_group_invitation_switch.sql.

-- Access model:
--   private   = creator only
--   shared    = creator + current group leader
--   workspace = creator + invited collaborators + current group leader
--
-- Leadership grants read access only. Editing a collaborative project still
-- requires an explicit project_members row with owner/editor permission.
create or replace function public.can_view_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.projects project
    where project.id = target_project
      and (
        project.created_by = auth.uid()
        or (
          project.visibility <> 'private'
          and public.is_workspace_leader(project.workspace_id)
          and not exists (
            select 1
            from public.project_access_dismissals dismissal
            where dismissal.project_id = project.id
              and dismissal.user_id = auth.uid()
          )
        )
        or (
          project.visibility = 'workspace'
          and exists (
            select 1
            from public.project_members member
            where member.project_id = project.id
              and member.user_id = auth.uid()
          )
        )
      )
  );
$$;

notify pgrst, 'reload schema';
