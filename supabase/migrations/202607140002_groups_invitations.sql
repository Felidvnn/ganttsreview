-- Orbit: group administration, invitations and final role visibility model.
-- Run this after 202607140001_initial_schema.sql.

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email))
  where email is not null;

alter table public.workspace_members
  add column if not exists is_admin boolean not null default false;

update public.workspace_members
set is_admin = true
where role = 'leader';

do $$ begin
  create type public.group_invitation_kind as enum ('invitation', 'join_request');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.group_invitation_status as enum ('pending', 'accepted', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  kind public.group_invitation_kind not null,
  status public.group_invitation_status not null default 'pending',
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists group_invitations_pending_unique_idx
  on public.group_invitations (workspace_id, subject_user_id, kind)
  where status = 'pending';
create index if not exists group_invitations_subject_idx
  on public.group_invitations (subject_user_id, status, created_at desc);
create index if not exists group_invitations_workspace_idx
  on public.group_invitations (workspace_id, status, created_at desc);

-- Keep profile data in sync for users created after this migration.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

create or replace function public.is_workspace_admin(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and (role = 'leader' or is_admin = true)
  );
$$;

-- Leaders see every project in their group. Engineers see owned, explicitly shared,
-- or group-visible projects. Leadership does not imply edit permission.
create or replace function public.can_view_project(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.projects p
    where p.id = target_project
      and public.is_workspace_member(p.workspace_id)
      and (
        p.created_by = auth.uid()
        or public.is_workspace_leader(p.workspace_id)
        or p.visibility = 'workspace'
        or exists(
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_edit_project(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.projects p
    where p.id = target_project
      and public.is_workspace_member(p.workspace_id)
      and (
        p.created_by = auth.uid()
        or exists(
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
            and pm.permission in ('owner', 'editor')
        )
      )
  );
$$;

drop policy if exists "leaders manage membership" on public.workspace_members;
drop policy if exists "owners delete projects" on public.projects;
create policy "creators delete projects" on public.projects for delete
  using (created_by = auth.uid() and public.is_workspace_member(workspace_id));

alter table public.group_invitations enable row level security;
create policy "participants view group invitations"
on public.group_invitations for select
using (
  subject_user_id = auth.uid()
  or initiated_by = auth.uid()
  or public.is_workspace_admin(workspace_id)
);

-- Existing bootstrap now marks the creator as group administrator.
create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  insert into public.workspaces (name, slug, created_by)
  values (trim(workspace_name), lower(trim(workspace_slug)), auth.uid())
  returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role, is_admin)
  values (new_id, auth.uid(), 'leader', true);
  return new_id;
end;
$$;

create or replace function public.invite_group_member(target_workspace uuid, target_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_user uuid; result_id uuid;
begin
  if not public.is_workspace_admin(target_workspace) then
    raise exception 'No tienes permisos para invitar integrantes';
  end if;

  select id into target_user
  from public.profiles
  where lower(email) = lower(trim(target_email));

  if target_user is null then
    raise exception 'No existe una cuenta registrada con ese correo';
  end if;
  if target_user = auth.uid() then
    raise exception 'Ya perteneces a este grupo';
  end if;
  if exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = target_user) then
    raise exception 'La persona ya pertenece al grupo';
  end if;

  select id into result_id
  from public.group_invitations
  where workspace_id = target_workspace and subject_user_id = target_user
    and kind = 'invitation' and status = 'pending';

  if result_id is null then
    insert into public.group_invitations (workspace_id, subject_user_id, initiated_by, kind)
    values (target_workspace, target_user, auth.uid(), 'invitation')
    returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.request_to_join_group(leader_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_workspace uuid; result_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select wm.workspace_id into target_workspace
  from public.profiles p
  join public.workspace_members wm on wm.user_id = p.id
  where lower(p.email) = lower(trim(leader_email)) and wm.role = 'leader'
  order by wm.joined_at asc
  limit 1;

  if target_workspace is null then
    raise exception 'No encontramos un líder de grupo con ese correo';
  end if;
  if exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid()) then
    raise exception 'Ya perteneces a ese grupo';
  end if;

  select id into result_id
  from public.group_invitations
  where workspace_id = target_workspace and subject_user_id = auth.uid()
    and kind = 'join_request' and status = 'pending';

  if result_id is null then
    insert into public.group_invitations (workspace_id, subject_user_id, initiated_by, kind)
    values (target_workspace, auth.uid(), auth.uid(), 'join_request')
    returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.respond_group_invitation(target_invitation uuid, accept_invitation boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.group_invitations%rowtype;
begin
  select * into item from public.group_invitations where id = target_invitation for update;
  if item.id is null or item.status <> 'pending' then
    raise exception 'La solicitud ya no está disponible';
  end if;
  if item.expires_at < now() then
    update public.group_invitations set status = 'cancelled', responded_at = now() where id = item.id;
    raise exception 'La solicitud expiró';
  end if;

  if item.kind = 'invitation' and item.subject_user_id <> auth.uid() then
    raise exception 'Solo la persona invitada puede responder';
  end if;
  if item.kind = 'join_request' and not public.is_workspace_admin(item.workspace_id) then
    raise exception 'Solo un administrador puede responder';
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

create or replace function public.cancel_group_invitation(target_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.group_invitations%rowtype;
begin
  select * into item from public.group_invitations where id = target_invitation for update;
  if item.id is null or item.status <> 'pending' then return; end if;
  if item.initiated_by <> auth.uid() and not public.is_workspace_admin(item.workspace_id) then
    raise exception 'No tienes permisos para cancelar esta solicitud';
  end if;
  update public.group_invitations
  set status = 'cancelled', responded_by = auth.uid(), responded_at = now()
  where id = item.id;
end;
$$;

create or replace function public.set_group_admin(target_workspace uuid, target_user uuid, admin_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_workspace_leader(target_workspace) then
    raise exception 'Solo un líder puede asignar administradores';
  end if;
  if not exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = target_user) then
    raise exception 'La persona no pertenece al grupo';
  end if;
  if exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = target_user and role = 'leader') then
    raise exception 'El líder siempre es administrador';
  end if;
  update public.workspace_members
  set is_admin = admin_enabled
  where workspace_id = target_workspace and user_id = target_user;
end;
$$;

create or replace function public.remove_group_member(target_workspace uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_workspace_admin(target_workspace) then
    raise exception 'No tienes permisos para eliminar integrantes';
  end if;
  if exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = target_user and role = 'leader') then
    raise exception 'No se puede eliminar al líder del grupo';
  end if;
  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user;
end;
$$;

create or replace function public.leave_group(target_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and role = 'leader') then
    raise exception 'El líder no puede abandonar el grupo sin transferirlo';
  end if;
  delete from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid();
end;
$$;

create or replace function public.share_project_with_email(target_project uuid, target_email text, target_permission public.project_permission)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_user uuid; target_workspace uuid;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para compartir este proyecto';
  end if;
  if target_permission = 'owner' then
    raise exception 'El rol de propietario no puede asignarse desde aquí';
  end if;

  select id into target_user from public.profiles where lower(email) = lower(trim(target_email));
  select workspace_id into target_workspace from public.projects where id = target_project;
  if target_user is null then raise exception 'No existe una cuenta con ese correo'; end if;
  if not exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = target_user) then
    raise exception 'La persona debe pertenecer al grupo antes de compartir el proyecto';
  end if;

  insert into public.project_members (project_id, user_id, permission, added_by)
  values (target_project, target_user, target_permission, auth.uid())
  on conflict (project_id, user_id) do update
  set permission = excluded.permission, added_by = excluded.added_by;
  return target_user;
end;
$$;

create or replace function public.remove_project_collaborator(target_project uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar colaboradores';
  end if;
  if exists(select 1 from public.projects where id = target_project and created_by = target_user) then
    raise exception 'No se puede quitar al creador del proyecto';
  end if;
  delete from public.project_members where project_id = target_project and user_id = target_user;
end;
$$;

revoke all on function public.create_workspace(text, text) from public;
revoke all on function public.invite_group_member(uuid, text) from public;
revoke all on function public.request_to_join_group(text) from public;
revoke all on function public.respond_group_invitation(uuid, boolean) from public;
revoke all on function public.cancel_group_invitation(uuid) from public;
revoke all on function public.set_group_admin(uuid, uuid, boolean) from public;
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.share_project_with_email(uuid, text, public.project_permission) from public;
revoke all on function public.remove_project_collaborator(uuid, uuid) from public;

grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.invite_group_member(uuid, text) to authenticated;
grant execute on function public.request_to_join_group(text) to authenticated;
grant execute on function public.respond_group_invitation(uuid, boolean) to authenticated;
grant execute on function public.cancel_group_invitation(uuid) to authenticated;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.share_project_with_email(uuid, text, public.project_permission) to authenticated;
grant execute on function public.remove_project_collaborator(uuid, uuid) to authenticated;
