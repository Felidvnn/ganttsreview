-- Orbit: non-destructive group exits and explicit project removal.
-- Run this after 202607170012_project_visibility_group_exit.sql.

-- Groups are soft-deleted when their only member leaves. Projects keep their
-- workspace reference and remain available to their owners/collaborators.
alter table public.workspaces
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- Preserve membership history even though the active membership must disappear
-- when somebody leaves or is removed from a group.
create table if not exists public.workspace_membership_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references public.profiles(id),
  role public.organization_role not null,
  was_admin boolean not null default false,
  joined_at timestamptz not null,
  ended_at timestamptz not null default now(),
  ended_by uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('left', 'removed', 'group_archived'))
);

create index if not exists workspace_membership_history_workspace_idx
  on public.workspace_membership_history(workspace_id, ended_at desc);
create index if not exists workspace_membership_history_user_idx
  on public.workspace_membership_history(user_id, ended_at desc);

alter table public.workspace_membership_history enable row level security;
create policy "users view own membership history"
on public.workspace_membership_history for select
using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));

-- A leader can dismiss a project shared with the group without changing the
-- owner's visibility setting. Explicit collaborators simply remove their own
-- project_members row instead.
create table if not exists public.project_access_dismissals (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_access_dismissals enable row level security;
create policy "users view own project dismissals"
on public.project_access_dismissals for select
using (user_id = auth.uid());

-- Only this confirmed RPC may physically delete a project. Direct client
-- deletes have no RLS policy, even for the creator.
drop policy if exists "creators delete projects" on public.projects;

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
          project.visibility = 'shared'
          and public.is_workspace_leader(project.workspace_id)
          and not exists (
            select 1 from public.project_access_dismissals dismissal
            where dismissal.project_id = project.id and dismissal.user_id = auth.uid()
          )
        )
        or (
          project.visibility = 'workspace'
          and exists (
            select 1 from public.project_members member
            where member.project_id = project.id and member.user_id = auth.uid()
          )
        )
      )
  );
$$;

create or replace function public.remove_my_project_access(target_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into item from public.projects where id = target_project;
  if item.id is null then raise exception 'El proyecto ya no existe'; end if;
  if item.created_by = auth.uid() then
    raise exception 'El propietario no puede quitar su propio acceso';
  end if;

  if exists (
    select 1 from public.project_members
    where project_id = target_project and user_id = auth.uid()
  ) then
    delete from public.project_members
    where project_id = target_project and user_id = auth.uid();
  elsif item.visibility = 'shared' and public.is_workspace_leader(item.workspace_id) then
    insert into public.project_access_dismissals(project_id, user_id)
    values (target_project, auth.uid())
    on conflict (project_id, user_id) do update set dismissed_at = now();
  else
    raise exception 'No tienes un acceso removible en este proyecto';
  end if;
end;
$$;

create or replace function public.delete_owned_project(
  target_project uuid,
  confirmation_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  project_name text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select created_by, name into owner_id, project_name
  from public.projects where id = target_project for update;
  if owner_id is null then raise exception 'El proyecto ya no existe'; end if;
  if owner_id <> auth.uid() then
    raise exception 'Solo el propietario real puede eliminar el proyecto';
  end if;
  if lower(trim(coalesce(confirmation_text, ''))) <> lower(trim(project_name)) then
    raise exception 'Escribe el nombre completo del proyecto para confirmar';
  end if;

  delete from public.projects where id = target_project;
end;
$$;

-- Changing the visibility is an explicit restore action, so stale personal
-- dismissals are cleared. No project content is affected.
create or replace function public.set_project_visibility(
  target_project uuid,
  next_visibility public.project_visibility
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  current_workspace uuid;
begin
  select created_by into owner_id from public.projects where id = target_project;
  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Solo el creador puede cambiar la visibilidad';
  end if;

  if next_visibility = 'shared' then
    select workspace_id into current_workspace
    from public.workspace_members
    where user_id = auth.uid()
    order by joined_at desc
    limit 1;
    if current_workspace is null then
      raise exception 'Debes pertenecer a un grupo para compartir con tu líder';
    end if;

    begin
      update public.projects
      set visibility = next_visibility, workspace_id = current_workspace
      where id = target_project;
    exception when unique_violation then
      raise exception 'Ya existe un proyecto con el mismo código en este grupo';
    end;
  else
    update public.projects set visibility = next_visibility where id = target_project;
  end if;

  delete from public.project_access_dismissals where project_id = target_project;
  if next_visibility <> 'workspace' then
    delete from public.project_members where project_id = target_project;
  end if;
end;
$$;

-- Removing somebody from a group only ends the active membership. Projects,
-- tasks, collaborative access and leader-shared visibility remain untouched.
create or replace function public.remove_group_member(target_workspace uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare membership public.workspace_members%rowtype;
begin
  if not public.is_workspace_admin(target_workspace) then
    raise exception 'No tienes permisos para eliminar integrantes';
  end if;
  select * into membership from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user for update;
  if membership.user_id is null then return; end if;
  if membership.role = 'leader' then
    raise exception 'No se puede eliminar al líder del grupo';
  end if;

  insert into public.workspace_membership_history(
    workspace_id, user_id, role, was_admin, joined_at, ended_by, reason
  ) values (
    membership.workspace_id, membership.user_id, membership.role,
    membership.is_admin, membership.joined_at, auth.uid(), 'removed'
  );
  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user;
end;
$$;

-- A sole leader can leave and soft-delete the group. If other members remain,
-- leadership transfer is still mandatory. No project or task is deleted.
create or replace function public.leave_group(
  target_workspace uuid,
  target_successor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership public.workspace_members%rowtype;
  member_count integer;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  perform 1 from public.workspaces where id = target_workspace for update;
  select * into membership from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid() for update;
  if membership.user_id is null then raise exception 'No perteneces a este grupo'; end if;
  select count(*) into member_count from public.workspace_members
  where workspace_id = target_workspace;

  if membership.role = 'leader' and member_count > 1 then
    if target_successor is null then
      raise exception 'Selecciona a un ingeniero para transferir el liderazgo';
    end if;
    if not exists (
      select 1 from public.workspace_members
      where workspace_id = target_workspace
        and user_id = target_successor
        and role = 'engineer'
    ) then raise exception 'El nuevo líder debe ser un ingeniero del grupo'; end if;

    update public.workspace_members
    set role = 'leader', is_admin = true
    where workspace_id = target_workspace and user_id = target_successor;
    update public.workspaces set created_by = target_successor
    where id = target_workspace;
  elsif membership.role = 'leader' and member_count = 1 then
    update public.group_invitations
    set status = 'cancelled', responded_by = auth.uid(), responded_at = now()
    where workspace_id = target_workspace and status = 'pending';
    update public.workspaces
    set archived_at = now(), archived_by = auth.uid()
    where id = target_workspace;
  end if;

  insert into public.workspace_membership_history(
    workspace_id, user_id, role, was_admin, joined_at, ended_by, reason
  ) values (
    membership.workspace_id, membership.user_id, membership.role,
    membership.is_admin, membership.joined_at, auth.uid(),
    case when membership.role = 'leader' and member_count = 1
      then 'group_archived' else 'left' end
  );
  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid();
end;
$$;

revoke all on function public.remove_my_project_access(uuid) from public;
revoke all on function public.delete_owned_project(uuid, text) from public;
revoke all on function public.leave_group(uuid, uuid) from public;
grant execute on function public.remove_my_project_access(uuid) to authenticated;
grant execute on function public.delete_owned_project(uuid, text) to authenticated;
grant execute on function public.leave_group(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
