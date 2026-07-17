-- Orbit: atomic project creation through a validated RPC.
-- Run this after 202607140002_groups_invitations.sql.

create or replace function public.create_project(
  target_workspace uuid,
  project_name text,
  project_code text,
  project_visibility public.project_visibility default 'private'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_project_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'No perteneces al grupo seleccionado';
  end if;

  if nullif(trim(project_name), '') is null then
    raise exception 'El proyecto debe tener un nombre';
  end if;

  if nullif(trim(project_code), '') is null then
    raise exception 'El proyecto debe tener un código';
  end if;

  insert into public.projects (
    workspace_id,
    name,
    code,
    visibility,
    created_by
  )
  values (
    target_workspace,
    trim(project_name),
    upper(trim(project_code)),
    project_visibility,
    auth.uid()
  )
  returning id into new_project_id;

  insert into public.project_members (
    project_id,
    user_id,
    permission,
    added_by
  )
  values (
    new_project_id,
    auth.uid(),
    'owner',
    auth.uid()
  );

  return new_project_id;
end;
$$;

revoke all on function public.create_project(uuid, text, text, public.project_visibility) from public;
grant execute on function public.create_project(uuid, text, text, public.project_visibility) to authenticated;

notify pgrst, 'reload schema';
