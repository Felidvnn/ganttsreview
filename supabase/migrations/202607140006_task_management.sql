-- Orbit: complete task editing, private notes, dependencies and project activity.
-- Run this after 202607140005_interactive_gantt.sql.

create table if not exists public.task_private_notes (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_private_notes enable row level security;

create policy "users view own task notes"
on public.task_private_notes for select
using (user_id = auth.uid() and exists (
  select 1 from public.tasks t
  where t.id = task_id and public.can_view_project(t.project_id)
));

create policy "users create own task notes"
on public.task_private_notes for insert
with check (user_id = auth.uid() and exists (
  select 1 from public.tasks t
  where t.id = task_id and public.can_view_project(t.project_id)
));

create policy "users update own task notes"
on public.task_private_notes for update
using (user_id = auth.uid() and exists (
  select 1 from public.tasks t
  where t.id = task_id and public.can_view_project(t.project_id)
))
with check (user_id = auth.uid() and exists (
  select 1 from public.tasks t
  where t.id = task_id and public.can_view_project(t.project_id)
));

create policy "users delete own task notes"
on public.task_private_notes for delete
using (user_id = auth.uid() and exists (
  select 1 from public.tasks t
  where t.id = task_id and public.can_view_project(t.project_id)
));

drop trigger if exists task_private_notes_updated on public.task_private_notes;
create trigger task_private_notes_updated
before update on public.task_private_notes
for each row execute function public.set_updated_at();

create or replace function public.update_task_details(
  target_task uuid,
  task_title text,
  task_description text,
  task_section text,
  task_start date,
  task_due date,
  task_status public.task_status,
  task_progress integer,
  task_is_milestone boolean,
  task_color text,
  target_assignee uuid,
  assignee_label text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project uuid;
  clean_section text := coalesce(nullif(trim(task_section), ''), 'General');
  clean_color text := coalesce(task_color, '#2f7669');
  final_due date;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar esta tarea';
  end if;
  if nullif(trim(task_title), '') is null then raise exception 'La tarea debe tener un nombre'; end if;
  if task_progress < 0 or task_progress > 100 then raise exception 'El avance debe estar entre 0 y 100'; end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color no es válido'; end if;

  final_due := case when coalesce(task_is_milestone, false) then coalesce(task_due, task_start) else task_due end;
  if final_due is not null and task_start is not null and final_due < task_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;

  perform public.add_project_section(target_project, clean_section);
  update public.tasks
  set title = trim(task_title),
      description = coalesce(trim(task_description), ''),
      section = clean_section,
      start_date = task_start,
      due_date = final_due,
      status = case when task_progress = 100 or task_status = 'done' then 'done'::public.task_status else task_status end,
      progress = case when task_status = 'done' then 100 else task_progress end,
      is_milestone = coalesce(task_is_milestone, false),
      color = clean_color,
      completed_at = case
        when task_progress = 100 or task_status = 'done' then coalesce(completed_at, now())
        else null
      end
  where id = target_task;

  perform public.set_task_owner(target_task, target_assignee, assignee_label);
end;
$$;

create or replace function public.delete_task(target_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para eliminar esta tarea';
  end if;
  delete from public.tasks where id = target_task;
end;
$$;

create or replace function public.update_task_progress(target_task uuid, next_progress integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar esta tarea';
  end if;
  if next_progress < 0 or next_progress > 100 then raise exception 'El avance debe estar entre 0 y 100'; end if;
  update public.tasks
  set progress = next_progress,
      status = case when next_progress = 100 then 'done'::public.task_status when status = 'done' then 'progress'::public.task_status else status end,
      completed_at = case when next_progress = 100 then coalesce(completed_at, now()) else null end
  where id = target_task;
end;
$$;

create or replace function public.add_task_dependency(
  target_predecessor uuid,
  target_successor uuid,
  target_type public.dependency_type default 'finish_start',
  target_lag_days integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  predecessor_project uuid;
  successor_project uuid;
  result_id uuid;
begin
  if target_predecessor = target_successor then raise exception 'Una tarea no puede bloquearse a sí misma'; end if;
  select project_id into predecessor_project from public.tasks where id = target_predecessor;
  select project_id into successor_project from public.tasks where id = target_successor;
  if predecessor_project is null or successor_project is null then raise exception 'La tarea seleccionada ya no existe'; end if;
  if not public.can_view_project(predecessor_project) or not public.can_edit_project(successor_project) then
    raise exception 'No tienes permisos para crear esta dependencia';
  end if;

  if exists (
    with recursive downstream(task_id) as (
      select successor_task_id from public.task_dependencies where predecessor_task_id = target_successor
      union
      select td.successor_task_id
      from public.task_dependencies td join downstream d on td.predecessor_task_id = d.task_id
    )
    select 1 from downstream where task_id = target_predecessor
  ) then raise exception 'Esta relación crearía un ciclo entre tareas'; end if;

  insert into public.task_dependencies (
    predecessor_task_id, successor_task_id, dependency_type, lag_days, created_by
  ) values (
    target_predecessor, target_successor, coalesce(target_type, 'finish_start'),
    coalesce(target_lag_days, 0), auth.uid()
  )
  on conflict (predecessor_task_id, successor_task_id) do update
  set dependency_type = excluded.dependency_type, lag_days = excluded.lag_days
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.remove_task_dependency(target_dependency uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare successor_project uuid;
begin
  select t.project_id into successor_project
  from public.task_dependencies d
  join public.tasks t on t.id = d.successor_task_id
  where d.id = target_dependency;
  if successor_project is null or not public.can_edit_project(successor_project) then
    raise exception 'No tienes permisos para eliminar esta dependencia';
  end if;
  delete from public.task_dependencies where id = target_dependency;
end;
$$;

create or replace function public.get_project_activity(target_project uuid, result_limit integer default 50)
returns table(
  id bigint,
  actor_name text,
  action text,
  entity_title text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    coalesce(p.full_name, 'Integrante'),
    a.action,
    coalesce(a.changes -> 'after' ->> 'title', a.changes ->> 'title', a.changes -> 'before' ->> 'title', 'una tarea'),
    a.created_at
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where public.can_view_project(target_project)
    and a.entity_type = 'task'
    and (
      exists (select 1 from public.tasks t where t.id = a.entity_id and t.project_id = target_project)
      or a.changes ->> 'project_id' = target_project::text
      or a.changes -> 'after' ->> 'project_id' = target_project::text
      or a.changes -> 'before' ->> 'project_id' = target_project::text
    )
  order by a.created_at desc
  limit least(greatest(coalesce(result_limit, 50), 1), 200);
$$;

revoke all on function public.update_task_details(uuid, text, text, text, date, date, public.task_status, integer, boolean, text, uuid, text) from public;
revoke all on function public.delete_task(uuid) from public;
revoke all on function public.update_task_progress(uuid, integer) from public;
revoke all on function public.add_task_dependency(uuid, uuid, public.dependency_type, integer) from public;
revoke all on function public.remove_task_dependency(uuid) from public;
revoke all on function public.get_project_activity(uuid, integer) from public;

grant execute on function public.update_task_details(uuid, text, text, text, date, date, public.task_status, integer, boolean, text, uuid, text) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.update_task_progress(uuid, integer) to authenticated;
grant execute on function public.add_task_dependency(uuid, uuid, public.dependency_type, integer) to authenticated;
grant execute on function public.remove_task_dependency(uuid) to authenticated;
grant execute on function public.get_project_activity(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
