-- Orbit: fix UUID project lookup in bulk task duplication.
-- Run this after 202607200019_project_notes_ordering_bulk_copy.sql.

create or replace function public.duplicate_tasks(target_tasks uuid[])
returns table(source_task uuid, duplicated_task uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.tasks%rowtype;
  target_project uuid;
  project_count integer;
  selected_count integer;
  source_count integer;
  next_order numeric(14,4);
  new_task uuid;
  new_parent uuid;
  id_map jsonb := '{}'::jsonb;
begin
  if target_tasks is null or cardinality(target_tasks) = 0 then
    raise exception 'Selecciona al menos una tarea';
  end if;

  -- PostgreSQL does not define min(uuid). Select one project explicitly and
  -- validate below that every selected task belongs to that same project.
  select task.project_id into target_project
  from public.tasks task
  where task.id = any(target_tasks)
  limit 1;

  select count(distinct task.project_id), count(*)
  into project_count, source_count
  from public.tasks task
  where task.id = any(target_tasks);

  select count(distinct selected.id) into selected_count
  from unnest(target_tasks) selected(id);

  if project_count <> 1 or source_count <> selected_count then
    raise exception 'Todas las tareas deben existir y pertenecer al mismo proyecto';
  end if;
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para duplicar estas tareas';
  end if;

  select coalesce(max(sort_order), 0) into next_order
  from public.tasks where project_id = target_project;

  for source in
    select task.*
    from public.tasks task
    where task.id = any(target_tasks)
    order by case
      when task.parent_id = any(target_tasks) and exists (
        select 1 from public.tasks parent
        where parent.id = task.parent_id and parent.parent_id = any(target_tasks)
      ) then 2
      when task.parent_id = any(target_tasks) then 1
      else 0
    end, task.sort_order, task.created_at
  loop
    next_order := next_order + 10;
    new_parent := source.parent_id;
    if source.parent_id is not null and id_map ? source.parent_id::text then
      new_parent := (id_map ->> source.parent_id::text)::uuid;
    end if;

    insert into public.tasks(
      project_id, parent_id, title, description, section, status, priority,
      start_date, due_date, baseline_start_date, baseline_due_date, progress,
      sort_order, is_milestone, created_by, completed_at, color,
      manual_assignee, rollup_progress, actual_completion_date, task_type_id
    ) values (
      source.project_id, new_parent, 'Copia de ' || source.title,
      source.description, source.section, 'todo', source.priority,
      source.start_date, source.due_date, source.start_date, source.due_date, 0,
      next_order, source.is_milestone, auth.uid(), null, source.color,
      source.manual_assignee, false, null, source.task_type_id
    ) returning id into new_task;

    insert into public.task_assignees(task_id, user_id, assigned_by)
    select new_task, user_id, auth.uid()
    from public.task_assignees where task_id = source.id;

    insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
    select new_task, assignee_id, auth.uid()
    from public.task_directory_assignees where task_id = source.id;

    id_map := id_map || jsonb_build_object(source.id::text, new_task::text);
    source_task := source.id;
    duplicated_task := new_task;
    return next;
  end loop;
end;
$$;

revoke all on function public.duplicate_tasks(uuid[]) from public;
grant execute on function public.duplicate_tasks(uuid[]) to authenticated;

notify pgrst, 'reload schema';
