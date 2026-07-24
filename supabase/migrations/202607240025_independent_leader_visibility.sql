-- Orbit: make collaboration and leader visibility independent project settings.
-- Run this after 202607240024_project_details_health.sql.

alter table public.projects
  add column if not exists visible_to_leader boolean not null default false;

-- Preserve every access that already existed before this setting was explicit.
update public.projects
set visible_to_leader = true
where visibility in ('shared', 'workspace')
  and visible_to_leader = false;

alter table public.projects
  drop constraint if exists projects_visibility_leader_consistency;
alter table public.projects
  add constraint projects_visibility_leader_consistency check (
    (visibility = 'private' and not visible_to_leader)
    or visibility = 'workspace'
    or (visibility = 'shared' and visible_to_leader)
  );

create or replace function public.normalize_project_leader_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'private' then
    new.visible_to_leader := false;
  elsif new.visibility = 'shared' then
    new.visible_to_leader := true;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_project_leader_visibility_before_insert on public.projects;
create trigger normalize_project_leader_visibility_before_insert
before insert on public.projects
for each row execute function public.normalize_project_leader_visibility();

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
          project.visible_to_leader
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
    and (
      new.visibility is distinct from old.visibility
      or new.workspace_id is distinct from old.workspace_id
      or new.visible_to_leader is distinct from old.visible_to_leader
    )
    and old.created_by <> auth.uid()
  then
    raise exception 'Solo el creador puede cambiar el acceso del proyecto';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_access_fields_before_update on public.projects;
create trigger protect_project_access_fields_before_update
before update of visibility, workspace_id, created_by, visible_to_leader on public.projects
for each row execute function public.protect_project_access_fields();

create or replace function public.configure_project_access(
  target_project uuid,
  collaboration_enabled boolean,
  show_to_leader boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  current_workspace uuid;
  next_visibility public.project_visibility;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select created_by into owner_id
  from public.projects
  where id = target_project
  for update;

  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Solo el creador puede cambiar el acceso';
  end if;

  next_visibility := case
    when coalesce(collaboration_enabled, false) then 'workspace'::public.project_visibility
    when coalesce(show_to_leader, false) then 'shared'::public.project_visibility
    else 'private'::public.project_visibility
  end;

  if coalesce(show_to_leader, false) then
    select workspace_id into current_workspace
    from public.workspace_members
    where user_id = auth.uid()
    order by joined_at desc
    limit 1;

    if current_workspace is null then
      raise exception 'Debes pertenecer a un grupo para mostrar el proyecto a tu líder';
    end if;

    begin
      update public.projects
      set visibility = next_visibility,
          visible_to_leader = true,
          workspace_id = current_workspace
      where id = target_project;
    exception when unique_violation then
      raise exception 'Ya existe un proyecto con el mismo código en este grupo';
    end;

    -- Re-enabling leader visibility is an explicit restore action.
    delete from public.project_access_dismissals
    where project_id = target_project;
  else
    update public.projects
    set visibility = next_visibility,
        visible_to_leader = false
    where id = target_project;
  end if;

  -- Collaboration rows are intentionally preserved while access is disabled.
  -- Re-enabling collaboration restores the previously invited people.
end;
$$;

-- Keep compatibility with older clients while routing changes through the
-- independent access model. The legacy collaborative option keeps its previous
-- behaviour and remains visible to the leader.
create or replace function public.set_project_visibility(
  target_project uuid,
  next_visibility public.project_visibility
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.configure_project_access(
    target_project,
    next_visibility = 'workspace',
    next_visibility <> 'private'
  );
end;
$$;

create or replace function public.remove_my_project_access(target_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.projects%rowtype;
  removed_membership integer := 0;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into item from public.projects where id = target_project;
  if item.id is null then raise exception 'El proyecto ya no existe'; end if;
  if item.created_by = auth.uid() then
    raise exception 'El propietario no puede quitar su propio acceso';
  end if;

  delete from public.project_members
  where project_id = target_project and user_id = auth.uid();
  get diagnostics removed_membership = row_count;

  if item.visible_to_leader and public.is_workspace_leader(item.workspace_id) then
    insert into public.project_access_dismissals(project_id, user_id)
    values (target_project, auth.uid())
    on conflict (project_id, user_id) do update set dismissed_at = now();
  elsif removed_membership = 0 then
    raise exception 'No tienes un acceso removible en este proyecto';
  end if;
end;
$$;

revoke all on function public.configure_project_access(uuid, boolean, boolean) from public;
grant execute on function public.configure_project_access(uuid, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
