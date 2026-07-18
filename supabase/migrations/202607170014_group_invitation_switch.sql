-- Orbit: visible cross-group invitations and safe one-click group switching.
-- Run this after 202607170013_safe_group_project_removal.sql.

-- An invited person needs the group name before becoming a member.
drop policy if exists "invited users view pending workspaces" on public.workspaces;
create policy "invited users view pending workspaces"
on public.workspaces for select
using (
  archived_at is null
  and exists (
    select 1
    from public.group_invitations invitation
    where invitation.workspace_id = workspaces.id
      and invitation.subject_user_id = auth.uid()
      and invitation.kind = 'invitation'
      and invitation.status = 'pending'
      and invitation.expires_at >= now()
  )
);

-- PostgreSQL resolves both CASE branches as text unless the enum cast is
-- explicit. This replaces the version that raised group_invitation_status/text.
create or replace function public.respond_group_invitation(
  target_invitation uuid,
  accept_invitation boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare item public.group_invitations%rowtype;
begin
  select * into item
  from public.group_invitations
  where id = target_invitation
  for update;

  if item.id is null or item.status <> 'pending' then
    raise exception 'La solicitud ya no está disponible';
  end if;
  if item.expires_at < now() then
    update public.group_invitations
    set status = 'cancelled'::public.group_invitation_status,
        responded_at = now()
    where id = item.id;
    raise exception 'La solicitud expiró';
  end if;
  if item.kind = 'invitation' and item.subject_user_id <> auth.uid() then
    raise exception 'Solo la persona invitada puede responder';
  end if;
  if item.kind = 'join_request' and not public.is_workspace_admin(item.workspace_id) then
    raise exception 'Solo un administrador puede responder';
  end if;

  if accept_invitation and exists (
    select 1
    from public.workspace_members membership
    where membership.user_id = item.subject_user_id
      and membership.workspace_id <> item.workspace_id
  ) then
    raise exception 'Ya perteneces a otro grupo. Usa la opción Cambiar a este grupo';
  end if;

  if accept_invitation then
    insert into public.workspace_members(workspace_id, user_id, role, is_admin)
    values (item.workspace_id, item.subject_user_id, 'engineer', false)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.group_invitations
  set status = case when accept_invitation
        then 'accepted'::public.group_invitation_status
        else 'rejected'::public.group_invitation_status
      end,
      responded_by = auth.uid(),
      responded_at = now()
  where id = item.id;
end;
$$;

-- Keep one active group at a time, but make switching atomic. leave_group keeps
-- every project and collaboration, archives a one-person group, or transfers
-- leadership when a successor is provided.
create or replace function public.switch_group_from_invitation(
  target_invitation uuid,
  target_successor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.group_invitations%rowtype;
  current_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into item
  from public.group_invitations
  where id = target_invitation
  for update;

  if item.id is null
    or item.kind <> 'invitation'
    or item.subject_user_id <> auth.uid()
    or item.status <> 'pending'
  then raise exception 'La invitación ya no está disponible'; end if;
  if item.expires_at < now() then
    update public.group_invitations
    set status = 'cancelled'::public.group_invitation_status,
        responded_at = now()
    where id = item.id;
    raise exception 'La invitación expiró';
  end if;
  if exists (
    select 1 from public.workspaces
    where id = item.workspace_id and archived_at is not null
  ) then raise exception 'El grupo invitante ya no está activo'; end if;

  select workspace_id into current_workspace
  from public.workspace_members
  where user_id = auth.uid()
  order by joined_at desc
  limit 1;

  if current_workspace is not null and current_workspace <> item.workspace_id then
    perform public.leave_group(current_workspace, target_successor);
  end if;

  insert into public.workspace_members(workspace_id, user_id, role, is_admin)
  values (item.workspace_id, auth.uid(), 'engineer', false)
  on conflict (workspace_id, user_id) do nothing;

  update public.group_invitations
  set status = 'accepted'::public.group_invitation_status,
      responded_by = auth.uid(),
      responded_at = now()
  where id = item.id;
end;
$$;

revoke all on function public.switch_group_from_invitation(uuid, uuid) from public;
grant execute on function public.switch_group_from_invitation(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
