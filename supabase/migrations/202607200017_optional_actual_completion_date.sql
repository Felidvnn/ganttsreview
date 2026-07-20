-- Orbit: keep the actual completion date optional and explicitly entered.
-- Run this after 202607200016_task_delays_actual_dates.sql.

-- Remove values that were inferred from completed_at by the previous migration.
-- A real date should be confirmed explicitly by a person.
update public.tasks
set actual_completion_date = null
where actual_completion_date is not null
  and completed_at is not null
  and actual_completion_date = completed_at::date;

-- Supplying a real date closes the task. Completing a task or reaching 100%
-- does not perform the opposite operation: it leaves the real date empty.
create or replace function public.sync_task_actual_completion_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.actual_completion_date is not null
    and old.actual_completion_date is not null
    and new.status <> 'done'
    and new.progress < 100
  then
    new.actual_completion_date := null;
  elsif new.actual_completion_date is not null then
    new.status := 'done'::public.task_status;
    new.progress := 100;
    new.completed_at := coalesce(
      new.completed_at,
      new.actual_completion_date::timestamp with time zone
    );
  end if;
  return new;
end;
$$;

-- Preserve the internal completed_at audit timestamp when editing dates. It is
-- separate from the optional, user-facing actual completion date.
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
      actual_completion_date = task_actual,
      status = case when task_actual is not null then 'done'::public.task_status else status end,
      progress = case when task_actual is not null then 100 else progress end,
      completed_at = case
        when task_actual is not null then coalesce(completed_at, task_actual::timestamp with time zone)
        else completed_at
      end
  where id = target_task;
end;
$$;

notify pgrst, 'reload schema';
