-- Orbit: allow invitation participants and group admins to identify each other.
-- Run this after 202607170010_drag_hierarchy.sql.

-- A pending group request is visible through group_invitations, but the embedded
-- profile was previously hidden until the person became a colleague. This policy
-- exposes only the two profiles involved in a pending request:
--   * the invited person can identify the inviter;
--   * a group administrator can identify the applicant/invitee.
drop policy if exists "profiles visible through pending group invitations" on public.profiles;
create policy "profiles visible through pending group invitations"
on public.profiles for select
using (
  exists (
    select 1
    from public.group_invitations invitation
    where invitation.status = 'pending'
      and invitation.expires_at >= now()
      and (
        (
          invitation.subject_user_id = auth.uid()
          and invitation.initiated_by = profiles.id
        )
        or (
          invitation.subject_user_id = profiles.id
          and public.is_workspace_admin(invitation.workspace_id)
        )
      )
  )
);

-- Expired requests should not continue appearing in the administration screen.
create or replace function public.expire_group_invitations(target_workspace uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  update public.group_invitations invitation
  set status = 'cancelled', responded_at = now()
  where invitation.status = 'pending'
    and invitation.expires_at < now()
    and (
      invitation.subject_user_id = auth.uid()
      or invitation.initiated_by = auth.uid()
      or (
        target_workspace is not null
        and invitation.workspace_id = target_workspace
        and public.is_workspace_admin(target_workspace)
      )
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_group_invitations(uuid) from public;
grant execute on function public.expire_group_invitations(uuid) to authenticated;

notify pgrst, 'reload schema';
