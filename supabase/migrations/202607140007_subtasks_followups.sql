-- Orbit: two-level subtasks, optional progress rollup and project follow-ups.
-- Run this after 202607140006_task_management.sql.

alter table public.tasks
  add column if not exists rollup_progress boolean not null default false;

create or replace function public.validate_task_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_project uuid;
  ancestor_count integer;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'Una tarea no puede ser su propia tarea padre'; end if;

  select project_id into parent_project from public.tasks where id = new.parent_id;
  if parent_project is null then raise exception 'La tarea padre ya no existe'; end if;
  if parent_project <> new.project_id then raise exception 'Las subtareas deben pertenecer al mismo proyecto'; end if;

  with recursive ancestors(id, parent_id, depth) as (
    select id, parent_id, 1 from public.tasks where id = new.parent_id
    union all
    select t.id, t.parent_id, a.depth + 1
    from public.tasks t join ancestors a on t.id = a.parent_id
  )
  select coalesce(max(depth), 0) into ancestor_count from ancestors;

  if ancestor_count > 2 then
    raise exception 'Solo se permiten subtareas y sub-subtareas';
  end if;

  if exists (
    with recursive descendants(id) as (
      select id from public.tasks where parent_id = new.id
      union all
      select t.id from public.tasks t join descendants d on t.parent_id = d.id
    )
    select 1 from descendants where id = new.parent_id
  ) then raise exception 'Esta relación crearía un ciclo en la jerarquía'; end if;
  return new;
end;
$$;

drop trigger if exists validate_tasks_hierarchy on public.tasks;
create trigger validate_tasks_hierarchy
before insert or update of parent_id, project_id on public.tasks
for each row execute function public.validate_task_hierarchy();

create or replace function public.refresh_task_rollup(starting_parent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task uuid := starting_parent;
  next_parent uuid;
  aggregate_progress integer;
  uses_rollup boolean;
begin
  while current_task is not null loop
    select parent_id, rollup_progress into next_parent, uses_rollup
    from public.tasks where id = current_task;

    if coalesce(uses_rollup, false) then
      select round(avg(progress))::integer into aggregate_progress
      from public.tasks where parent_id = current_task;
      if aggregate_progress is not null then
        update public.tasks
        set progress = aggregate_progress,
            status = case
              when aggregate_progress = 100 then 'done'::public.task_status
              when status = 'done' then 'progress'::public.task_status
              else status
            end,
            completed_at = case when aggregate_progress = 100 then coalesce(completed_at, now()) else null end
        where id = current_task;
      end if;
    end if;
    current_task := next_parent;
  end loop;
end;
$$;

create or replace function public.handle_child_progress_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform public.refresh_task_rollup(old.parent_id);
  elsif tg_op = 'INSERT' then
    perform public.refresh_task_rollup(new.parent_id);
  else
    perform public.refresh_task_rollup(old.parent_id);
    if new.parent_id is distinct from old.parent_id then perform public.refresh_task_rollup(new.parent_id); end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists child_progress_rollup on public.tasks;
create trigger child_progress_rollup
after insert or delete or update of progress, parent_id, rollup_progress on public.tasks
for each row execute function public.handle_child_progress_change();

create or replace function public.set_task_rollup(target_task uuid, rollup_enabled boolean)
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
  update public.tasks set rollup_progress = coalesce(rollup_enabled, false) where id = target_task;
  perform public.refresh_task_rollup(target_task);
end;
$$;

create or replace function public.create_subtask(
  target_parent uuid,
  task_title text,
  task_start date,
  task_due date,
  target_assignee uuid,
  assignee_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_task public.tasks%rowtype;
  new_task_id uuid;
  next_order numeric(14,4);
begin
  select * into parent_task from public.tasks where id = target_parent;
  if parent_task.id is null or not public.can_edit_project(parent_task.project_id) then
    raise exception 'No tienes permisos para agregar subtareas';
  end if;
  if nullif(trim(task_title), '') is null then raise exception 'La subtarea debe tener un nombre'; end if;
  if task_due is not null and task_start is not null and task_due < task_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;

  select coalesce(max(sort_order), parent_task.sort_order) + 10 into next_order
  from public.tasks where project_id = parent_task.project_id;

  insert into public.tasks (
    project_id, parent_id, title, section, status, priority, start_date, due_date,
    baseline_start_date, baseline_due_date, progress, sort_order, color, created_by
  ) values (
    parent_task.project_id, target_parent, trim(task_title), parent_task.section, 'todo',
    parent_task.priority, task_start, task_due, task_start, task_due, 0, next_order,
    parent_task.color, auth.uid()
  ) returning id into new_task_id;

  perform public.set_task_owner(new_task_id, target_assignee, assignee_label);
  return new_task_id;
end;
$$;

do $$ begin
  create type public.followup_status as enum ('open', 'done', 'blocked');
exception when duplicate_object then null;
end $$;

create table if not exists public.project_followups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  notes text not null default '' check (char_length(notes) <= 10000),
  owner_label text,
  due_date date,
  status public.followup_status not null default 'open',
  is_blocker boolean not null default false,
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_followups_project_status_idx
  on public.project_followups(project_id, status, due_date);
create index if not exists project_followups_task_idx
  on public.project_followups(task_id) where task_id is not null;

create or replace function public.validate_followup_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id
  ) then raise exception 'La tarea asociada debe pertenecer al mismo proyecto'; end if;
  new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) else null end;
  return new;
end;
$$;

drop trigger if exists validate_project_followup_task on public.project_followups;
create trigger validate_project_followup_task
before insert or update of task_id, project_id, status on public.project_followups
for each row execute function public.validate_followup_task();

drop trigger if exists project_followups_updated on public.project_followups;
create trigger project_followups_updated
before update on public.project_followups
for each row execute function public.set_updated_at();

alter table public.project_followups enable row level security;
create policy "followups visible with project"
on public.project_followups for select
using (public.can_view_project(project_id));
create policy "editors create followups"
on public.project_followups for insert
with check (public.can_edit_project(project_id) and created_by = auth.uid());
create policy "editors update followups"
on public.project_followups for update
using (public.can_edit_project(project_id))
with check (public.can_edit_project(project_id));
create policy "editors delete followups"
on public.project_followups for delete
using (public.can_edit_project(project_id));

revoke all on function public.set_task_rollup(uuid, boolean) from public;
revoke all on function public.create_subtask(uuid, text, date, date, uuid, text) from public;
revoke all on function public.refresh_task_rollup(uuid) from public;
revoke all on function public.handle_child_progress_change() from public;
revoke all on function public.validate_task_hierarchy() from public;
revoke all on function public.validate_followup_task() from public;
grant execute on function public.set_task_rollup(uuid, boolean) to authenticated;
grant execute on function public.create_subtask(uuid, text, date, date, uuid, text) to authenticated;

alter publication supabase_realtime add table public.project_followups;
notify pgrst, 'reload schema';
