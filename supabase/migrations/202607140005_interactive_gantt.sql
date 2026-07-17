-- Orbit: interactive Gantt metadata, scheduling and assignee helpers.
-- Run this after 202607140004_project_sections.sql.

alter table public.tasks
  add column if not exists color text not null default '#2f7669',
  add column if not exists manual_assignee text;

do $$ begin
  alter table public.tasks add constraint tasks_color_format_check
    check (color ~ '^#[0-9A-Fa-f]{6}$');
exception when duplicate_object then null;
end $$;

create or replace function public.create_task_with_details(
  target_project uuid,
  task_title text,
  task_section text,
  task_start date,
  task_due date,
  task_is_milestone boolean,
  task_color text,
  task_status public.task_status,
  target_assignee uuid,
  assignee_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_task_id uuid;
  target_workspace uuid;
  clean_color text := coalesce(task_color, '#2f7669');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if not public.can_edit_project(target_project) then raise exception 'No tienes permisos para editar este proyecto'; end if;
  if nullif(trim(task_title), '') is null then raise exception 'La tarea debe tener un nombre'; end if;
  if task_due is not null and task_start is not null and task_due < task_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color no es válido'; end if;

  perform public.add_project_section(target_project, coalesce(nullif(trim(task_section), ''), 'General'));
  select workspace_id into target_workspace from public.projects where id = target_project;

  if target_assignee is not null and not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = target_assignee
  ) then
    raise exception 'El responsable debe pertenecer al grupo';
  end if;

  insert into public.tasks (
    project_id, title, section, start_date, due_date, is_milestone,
    color, status, progress, manual_assignee, created_by, completed_at
  ) values (
    target_project,
    trim(task_title),
    coalesce(nullif(trim(task_section), ''), 'General'),
    task_start,
    case when task_is_milestone then coalesce(task_due, task_start) else task_due end,
    coalesce(task_is_milestone, false),
    clean_color,
    coalesce(task_status, 'todo'),
    case when task_status = 'done' then 100 else 0 end,
    case when target_assignee is null then nullif(trim(assignee_label), '') else null end,
    auth.uid(),
    case when task_status = 'done' then now() else null end
  ) returning id into new_task_id;

  if target_assignee is not null then
    insert into public.task_assignees (task_id, user_id, assigned_by)
    values (new_task_id, target_assignee, auth.uid());
  end if;
  return new_task_id;
end;
$$;

create or replace function public.update_task_schedule(
  target_task uuid,
  task_start date,
  task_due date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para reprogramar esta tarea';
  end if;
  if task_due is not null and task_start is not null and task_due < task_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;
  update public.tasks set start_date = task_start, due_date = task_due where id = target_task;
end;
$$;

create or replace function public.update_task_presentation(
  target_task uuid,
  next_status public.task_status,
  next_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid; clean_color text := coalesce(next_color, '#2f7669');
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar esta tarea';
  end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color no es válido'; end if;
  update public.tasks
  set status = next_status,
      color = clean_color,
      progress = case when next_status = 'done' then 100 when status = 'done' then 0 else progress end,
      completed_at = case when next_status = 'done' then coalesce(completed_at, now()) else null end
  where id = target_task;
end;
$$;

create or replace function public.set_task_owner(
  target_task uuid,
  target_assignee uuid,
  assignee_label text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid; target_workspace uuid;
begin
  select t.project_id, p.workspace_id into target_project, target_workspace
  from public.tasks t join public.projects p on p.id = t.project_id
  where t.id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para cambiar el responsable';
  end if;
  if target_assignee is not null and not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = target_assignee
  ) then raise exception 'El responsable debe pertenecer al grupo'; end if;

  delete from public.task_assignees where task_id = target_task;
  if target_assignee is not null then
    insert into public.task_assignees (task_id, user_id, assigned_by)
    values (target_task, target_assignee, auth.uid());
  end if;
  update public.tasks
  set manual_assignee = case when target_assignee is null then nullif(trim(assignee_label), '') else null end
  where id = target_task;
end;
$$;

create or replace function public.get_project_assignable_members(target_project uuid)
returns table(user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select wm.user_id, p.full_name, coalesce(p.email, '')
  from public.projects pr
  join public.workspace_members wm on wm.workspace_id = pr.workspace_id
  join public.profiles p on p.id = wm.user_id
  where pr.id = target_project and public.can_view_project(pr.id)
  order by case when wm.role = 'leader' then 0 else 1 end, lower(p.full_name);
$$;

revoke all on function public.create_task_with_details(uuid, text, text, date, date, boolean, text, public.task_status, uuid, text) from public;
revoke all on function public.update_task_schedule(uuid, date, date) from public;
revoke all on function public.update_task_presentation(uuid, public.task_status, text) from public;
revoke all on function public.set_task_owner(uuid, uuid, text) from public;
revoke all on function public.get_project_assignable_members(uuid) from public;
grant execute on function public.create_task_with_details(uuid, text, text, date, date, boolean, text, public.task_status, uuid, text) to authenticated;
grant execute on function public.update_task_schedule(uuid, date, date) to authenticated;
grant execute on function public.update_task_presentation(uuid, public.task_status, text) to authenticated;
grant execute on function public.set_task_owner(uuid, uuid, text) to authenticated;
grant execute on function public.get_project_assignable_members(uuid) to authenticated;

notify pgrst, 'reload schema';

