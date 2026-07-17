-- Orbit: personal, leader-shared and invite-only collaborative projects.
-- Also allows safe group exit while preserving projects owned by the user.
-- Run this after 202607170011_admin_invitation_readiness.sql.

-- Visibility semantics:
-- private   = creator only
-- shared    = creator + leader of the project's current group (read-only unless invited)
-- workspace = creator + explicitly invited project collaborators
-- Existing projects marked shared with explicit collaborators become collaborative.
update public.projects project
set visibility = 'workspace'
where project.visibility = 'shared'
  and exists (
    select 1 from public.project_members member where member.project_id = project.id
  );

create index if not exists workspace_members_user_idx
  on public.workspace_members(user_id, joined_at desc);
create index if not exists project_members_user_idx
  on public.project_members(user_id, project_id);

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

create or replace function public.can_edit_project(target_project uuid)
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
          project.visibility = 'workspace'
          and exists (
            select 1 from public.project_members member
            where member.project_id = project.id
              and member.user_id = auth.uid()
              and member.permission in ('owner', 'editor')
          )
        )
      )
  );
$$;

create or replace function public.is_project_owner(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects
    where id = target_project and created_by = auth.uid()
  );
$$;

drop policy if exists "creators delete projects" on public.projects;
create policy "creators delete projects"
on public.projects for delete
using (created_by = auth.uid());

drop policy if exists "project owners manage members" on public.project_members;
create policy "creators manage project members"
on public.project_members for all
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

create or replace function public.protect_project_access_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'No se puede cambiar el creador del proyecto';
  end if;
  if current_setting('orbit.allow_access_change', true) is distinct from 'on'
    and (new.visibility is distinct from old.visibility or new.workspace_id is distinct from old.workspace_id)
    and old.created_by <> auth.uid() then
    raise exception 'Solo el creador puede cambiar el acceso del proyecto';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_access_fields_before_update on public.projects;
create trigger protect_project_access_fields_before_update
before update of visibility, workspace_id, created_by on public.projects
for each row execute function public.protect_project_access_fields();

-- Cross-group collaborators need to identify the creator and the other people
-- explicitly participating in the same collaborative project.
create or replace function public.shares_collaborative_project(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects project
    where project.visibility = 'workspace'
      and (
        project.created_by = auth.uid()
        or exists (
          select 1 from public.project_members mine
          where mine.project_id = project.id and mine.user_id = auth.uid()
        )
      )
      and (
        project.created_by = target_profile
        or exists (
          select 1 from public.project_members theirs
          where theirs.project_id = project.id and theirs.user_id = target_profile
        )
        or exists (
          select 1
          from public.tasks task
          join public.task_assignees assignee on assignee.task_id = task.id
          where task.project_id = project.id and assignee.user_id = target_profile
        )
        or exists (
          select 1
          from public.tasks task
          join public.comments comment on comment.task_id = task.id
          where task.project_id = project.id and comment.author_id = target_profile
        )
      )
  );
$$;

drop policy if exists "profiles visible through collaborative projects" on public.profiles;
create policy "profiles visible through collaborative projects"
on public.profiles for select
using (public.shares_collaborative_project(id));

create or replace function public.can_view_audit_entry(
  target_entity_type text,
  target_entity_id uuid,
  target_changes jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_project uuid; project_text text;
begin
  if target_entity_type <> 'task' then return false; end if;
  select project_id into target_project from public.tasks where id = target_entity_id;
  if target_project is null then
    project_text := coalesce(
      target_changes ->> 'project_id',
      target_changes -> 'after' ->> 'project_id',
      target_changes -> 'before' ->> 'project_id'
    );
    if project_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      target_project := project_text::uuid;
    end if;
  end if;
  return target_project is not null and public.can_view_project(target_project);
end;
$$;

drop policy if exists "leaders view audit logs" on public.audit_logs;
drop policy if exists "audit logs visible with project" on public.audit_logs;
create policy "audit logs visible with project"
on public.audit_logs for select
using (public.can_view_audit_entry(entity_type, entity_id, changes));

-- Personal follow-up items belong to the person, even after changing groups.
drop policy if exists "users manage own weekly items" on public.weekly_items;
create policy "users manage own weekly items"
on public.weekly_items for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

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

  if next_visibility <> 'workspace' then
    delete from public.project_members where project_id = target_project;
  end if;
end;
$$;

create or replace function public.share_project_with_email(
  target_project uuid,
  target_email text,
  target_permission public.project_permission
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_user uuid; owner_id uuid;
begin
  select created_by into owner_id from public.projects where id = target_project;
  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Solo el creador puede invitar colaboradores';
  end if;
  if target_permission = 'owner' then
    raise exception 'El rol de propietario no puede asignarse desde aquí';
  end if;

  select id into target_user
  from public.profiles
  where lower(email) = lower(trim(target_email));
  if target_user is null then raise exception 'No existe una cuenta con ese correo'; end if;
  if target_user = auth.uid() then raise exception 'Ya eres el propietario del proyecto'; end if;

  insert into public.project_members (project_id, user_id, permission, added_by)
  values (target_project, target_user, target_permission, auth.uid())
  on conflict (project_id, user_id) do update
  set permission = excluded.permission, added_by = excluded.added_by;

  update public.projects set visibility = 'workspace' where id = target_project;
  return target_user;
end;
$$;

create or replace function public.remove_project_collaborator(target_project uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  select created_by into owner_id from public.projects where id = target_project;
  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Solo el creador puede modificar colaboradores';
  end if;
  if owner_id = target_user then raise exception 'No se puede quitar al creador del proyecto'; end if;
  delete from public.project_members where project_id = target_project and user_id = target_user;
end;
$$;

-- A user can belong to one group at a time. Pending invitations can be received
-- while still in another group, but must be accepted after leaving it.
create or replace function public.respond_group_invitation(target_invitation uuid, accept_invitation boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare item public.group_invitations%rowtype;
begin
  select * into item from public.group_invitations where id = target_invitation for update;
  if item.id is null or item.status <> 'pending' then
    raise exception 'La solicitud ya no está disponible';
  end if;
  if item.expires_at < now() then
    raise exception 'La solicitud expiró';
  end if;
  if item.kind = 'invitation' and item.subject_user_id <> auth.uid() then
    raise exception 'Solo la persona invitada puede responder';
  end if;
  if item.kind = 'join_request' and not public.is_workspace_admin(item.workspace_id) then
    raise exception 'Solo un administrador puede responder';
  end if;

  if accept_invitation and exists (
    select 1 from public.workspace_members membership
    where membership.user_id = item.subject_user_id
      and membership.workspace_id <> item.workspace_id
  ) then
    raise exception 'La persona debe salir de su grupo actual antes de incorporarse';
  end if;

  if accept_invitation then
    insert into public.workspace_members (workspace_id, user_id, role, is_admin)
    values (item.workspace_id, item.subject_user_id, 'engineer', false)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.group_invitations
  set status = case when accept_invitation then 'accepted' else 'rejected' end,
      responded_by = auth.uid(), responded_at = now()
  where id = item.id;
end;
$$;

create or replace function public.remove_group_member(target_workspace uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(target_workspace) then
    raise exception 'No tienes permisos para eliminar integrantes';
  end if;
  if exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = target_user and role = 'leader'
  ) then raise exception 'No se puede eliminar al líder del grupo'; end if;

  perform set_config('orbit.allow_access_change', 'on', true);
  update public.projects
  set visibility = 'private'
  where workspace_id = target_workspace
    and created_by = target_user
    and visibility = 'shared';
  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user;
end;
$$;

-- Engineers leave directly. A leader must nominate an engineer, who becomes
-- leader atomically before the current leader is removed.
drop function if exists public.leave_group(uuid);
create function public.leave_group(target_workspace uuid, target_successor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_role public.organization_role;
begin
  select role into current_role
  from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid()
  for update;
  if current_role is null then raise exception 'No perteneces a este grupo'; end if;

  if current_role = 'leader' then
    if target_successor is null then
      raise exception 'Selecciona a un ingeniero para transferir el liderazgo';
    end if;
    if not exists (
      select 1 from public.workspace_members
      where workspace_id = target_workspace and user_id = target_successor and role = 'engineer'
    ) then raise exception 'El nuevo líder debe ser un ingeniero del grupo'; end if;

    update public.workspace_members
    set role = 'leader', is_admin = true
    where workspace_id = target_workspace and user_id = target_successor;
    update public.workspaces set created_by = target_successor where id = target_workspace;
  end if;

  -- The previous leader immediately loses access to leader-shared projects.
  update public.projects
  set visibility = 'private'
  where workspace_id = target_workspace
    and created_by = auth.uid()
    and visibility = 'shared';

  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid();
end;
$$;

revoke all on function public.shares_collaborative_project(uuid) from public;
revoke all on function public.set_project_visibility(uuid, public.project_visibility) from public;
revoke all on function public.leave_group(uuid, uuid) from public;
grant execute on function public.set_project_visibility(uuid, public.project_visibility) to authenticated;
grant execute on function public.leave_group(uuid, uuid) to authenticated;
grant execute on function public.shares_collaborative_project(uuid) to authenticated;

notify pgrst, 'reload schema';
