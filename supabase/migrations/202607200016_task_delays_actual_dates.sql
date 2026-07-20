-- Orbit: actual completion dates, multiple assignees, delay records and safe task duplication.
-- Run this after 202607170015_leader_team_visibility.sql.

alter table public.tasks
  add column if not exists actual_completion_date date;

-- Saved project-specific people can now be assigned alongside registered users.
-- The existing directory is kept for backwards compatibility, but the UI treats
-- these rows as project contacts rather than forcing the "external" label.
create table if not exists public.task_directory_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid not null references public.project_external_assignees(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, assignee_id)
);

create index if not exists task_directory_assignees_assignee_idx
  on public.task_directory_assignees(assignee_id, task_id);

alter table public.task_directory_assignees enable row level security;
create policy "directory assignees visible with task"
on public.task_directory_assignees for select
using (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_view_project(task.project_id)
));
create policy "editors manage directory assignees"
on public.task_directory_assignees for all
using (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_edit_project(task.project_id)
))
with check (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_edit_project(task.project_id)
));

-- Recover the single free-text owner used by older versions.
insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
select task.id, directory.id, task.created_by
from public.tasks task
join public.project_external_assignees directory
  on directory.project_id = task.project_id
 and lower(directory.name) = lower(trim(task.manual_assignee))
where nullif(trim(task.manual_assignee), '') is not null
on conflict do nothing;

create table if not exists public.task_delay_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  delay_days integer not null check (delay_days between 1 and 3650),
  occurred_on date not null default current_date,
  notes text not null default '' check (char_length(notes) <= 10000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_delay_records_task_date_idx
  on public.task_delay_records(task_id, occurred_on desc, created_at desc);

alter table public.task_delay_records enable row level security;
create policy "delays visible with project"
on public.task_delay_records for select
using (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_view_project(task.project_id)
));
create policy "editors manage delays"
on public.task_delay_records for all
using (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_edit_project(task.project_id)
))
with check (exists (
  select 1 from public.tasks task
  where task.id = task_id and public.can_edit_project(task.project_id)
));

drop trigger if exists task_delay_records_updated on public.task_delay_records;
create trigger task_delay_records_updated
before update on public.task_delay_records
for each row execute function public.set_updated_at();

create or replace function public.update_task_dates(
  target_task uuid,
  task_start date,
  task_due date,
  task_actual date default null
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
    raise exception 'No tienes permisos para cambiar las fechas de esta tarea';
  end if;
  if task_due is not null and task_start is not null and task_due < task_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;

  update public.tasks
  set start_date = task_start,
      due_date = case when is_milestone then coalesce(task_due, task_start) else task_due end,
      actual_completion_date = task_actual
  where id = target_task;
end;
$$;

create or replace function public.set_task_assignees(
  target_task uuid,
  target_users uuid[] default '{}'::uuid[],
  target_directory_assignees uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid; target_workspace uuid; first_directory_name text;
begin
  select task.project_id, project.workspace_id
  into target_project, target_workspace
  from public.tasks task
  join public.projects project on project.id = task.project_id
  where task.id = target_task;

  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para cambiar los responsables';
  end if;

  if exists (
    select 1 from unnest(coalesce(target_users, '{}'::uuid[])) selected(user_id)
    where not exists (
      select 1 from public.projects project
      where project.id = target_project
        and (
          project.created_by = selected.user_id
          or exists (select 1 from public.workspace_members member where member.workspace_id = target_workspace and member.user_id = selected.user_id)
          or exists (select 1 from public.project_members member where member.project_id = target_project and member.user_id = selected.user_id)
        )
    )
  ) then raise exception 'Uno de los responsables no tiene acceso al proyecto'; end if;

  if exists (
    select 1 from unnest(coalesce(target_directory_assignees, '{}'::uuid[])) selected(assignee_id)
    where not exists (
      select 1 from public.project_external_assignees directory
      where directory.id = selected.assignee_id and directory.project_id = target_project
    )
  ) then raise exception 'Uno de los responsables guardados no pertenece al proyecto'; end if;

  delete from public.task_assignees where task_id = target_task;
  insert into public.task_assignees(task_id, user_id, assigned_by)
  select target_task, selected.user_id, auth.uid()
  from (select distinct unnest(coalesce(target_users, '{}'::uuid[])) as user_id) selected
  where selected.user_id is not null;

  delete from public.task_directory_assignees where task_id = target_task;
  insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
  select target_task, selected.assignee_id, auth.uid()
  from (select distinct unnest(coalesce(target_directory_assignees, '{}'::uuid[])) as assignee_id) selected
  where selected.assignee_id is not null;

  select directory.name into first_directory_name
  from public.project_external_assignees directory
  where directory.id = any(coalesce(target_directory_assignees, '{}'::uuid[]))
  order by lower(directory.name)
  limit 1;
  update public.tasks set manual_assignee = first_directory_name where id = target_task;
end;
$$;

create or replace function public.save_task_delay(
  target_task uuid,
  delay_reason text,
  target_delay_days integer,
  target_occurred_on date default current_date,
  delay_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid; result_id uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para registrar atrasos en esta tarea';
  end if;
  if nullif(trim(delay_reason), '') is null then raise exception 'Indica el motivo del atraso'; end if;
  if target_delay_days not between 1 and 3650 then raise exception 'Los días de atraso no son válidos'; end if;

  insert into public.task_delay_records(task_id, reason, delay_days, occurred_on, notes, created_by)
  values (target_task, trim(delay_reason), target_delay_days, coalesce(target_occurred_on, current_date), coalesce(trim(delay_notes), ''), auth.uid())
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.delete_task_delay(target_delay uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid;
begin
  select task.project_id into target_project
  from public.task_delay_records delay
  join public.tasks task on task.id = delay.task_id
  where delay.id = target_delay;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para eliminar este registro';
  end if;
  delete from public.task_delay_records where id = target_delay;
end;
$$;

create or replace function public.duplicate_task(target_task uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare source public.tasks%rowtype; new_task_id uuid; next_order numeric(14,4);
begin
  select * into source from public.tasks where id = target_task;
  if source.id is null or not public.can_edit_project(source.project_id) then
    raise exception 'No tienes permisos para duplicar esta tarea';
  end if;

  select coalesce(max(sort_order), 0) + 10 into next_order
  from public.tasks where project_id = source.project_id;

  insert into public.tasks(
    project_id, parent_id, title, description, section, status, priority,
    start_date, due_date, baseline_start_date, baseline_due_date, progress,
    sort_order, is_milestone, created_by, completed_at, color,
    manual_assignee, rollup_progress, actual_completion_date
  ) values (
    source.project_id, source.parent_id, 'Copia de ' || source.title,
    source.description, source.section, 'todo', source.priority,
    source.start_date, source.due_date, source.start_date, source.due_date, 0,
    next_order, source.is_milestone, auth.uid(), null, source.color,
    source.manual_assignee, false, null
  ) returning id into new_task_id;

  insert into public.task_assignees(task_id, user_id, assigned_by)
  select new_task_id, user_id, auth.uid()
  from public.task_assignees where task_id = target_task;
  insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
  select new_task_id, assignee_id, auth.uid()
  from public.task_directory_assignees where task_id = target_task;
  return new_task_id;
end;
$$;

revoke all on function public.update_task_dates(uuid, date, date, date) from public;
revoke all on function public.set_task_assignees(uuid, uuid[], uuid[]) from public;
revoke all on function public.save_task_delay(uuid, text, integer, date, text) from public;
revoke all on function public.delete_task_delay(uuid) from public;
revoke all on function public.duplicate_task(uuid) from public;
grant execute on function public.update_task_dates(uuid, date, date, date) to authenticated;
grant execute on function public.set_task_assignees(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.save_task_delay(uuid, text, integer, date, text) to authenticated;
grant execute on function public.delete_task_delay(uuid) to authenticated;
grant execute on function public.duplicate_task(uuid) to authenticated;

notify pgrst, 'reload schema';
