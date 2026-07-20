-- Orbit: safe project deletion, bulk task copies, manual planning order and project notes.
-- Run this after 202607200018_flexible_dates_task_types_import.sql.

-- When a project is deleted, its tasks disappear through ON DELETE CASCADE.
-- At that point the parent project may no longer be visible to the task audit
-- trigger. Skip only that orphaned cascade event; direct task changes continue
-- to be recorded normally.
create or replace function public.audit_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_project uuid; target_workspace uuid; change_data jsonb;
begin
  target_project := coalesce(new.project_id, old.project_id);
  select workspace_id into target_workspace
  from public.projects where id = target_project;

  if target_workspace is null then
    return coalesce(new, old);
  end if;

  change_data := case when tg_op = 'UPDATE'
    then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    else coalesce(to_jsonb(new), to_jsonb(old)) end;
  insert into public.audit_logs(workspace_id, actor_id, entity_type, entity_id, action, changes)
  values(target_workspace, auth.uid(), 'task', coalesce(new.id, old.id), lower(tg_op), change_data);
  return coalesce(new, old);
end;
$$;

alter table public.projects
  add column if not exists task_order_mode text not null default 'date'
  check (task_order_mode in ('date', 'manual'));

create or replace function public.save_project_plan_order(
  target_project uuid,
  ordered_sections text[],
  ordered_tasks uuid[],
  next_mode text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare supplied_count integer; matched_count integer;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para ordenar este proyecto';
  end if;
  if next_mode not in ('date', 'manual') then raise exception 'El modo de orden no es válido'; end if;

  if ordered_sections is not null then
    update public.project_sections section
    set sort_order = position.ordinality * 1000
    from unnest(ordered_sections) with ordinality position(name, ordinality)
    where section.project_id = target_project
      and lower(section.name) = lower(position.name);
  end if;

  if ordered_tasks is not null then
    select count(distinct selected.id) into supplied_count
    from unnest(ordered_tasks) selected(id);
    select count(*) into matched_count from public.tasks
    where project_id = target_project and id = any(ordered_tasks);
    if supplied_count <> matched_count then
      raise exception 'Una de las tareas no pertenece al proyecto';
    end if;
    update public.tasks task
    set sort_order = position.ordinality * 10
    from unnest(ordered_tasks) with ordinality position(id, ordinality)
    where task.id = position.id and task.project_id = target_project;
  end if;

  update public.projects set task_order_mode = next_mode where id = target_project;
end;
$$;

-- Duplicate several tasks in one transaction. When both a parent and one of
-- its children are selected, the copied hierarchy points to the copied parent.
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

  select task.project_id into target_project
  from public.tasks task
  where task.id = any(target_tasks)
  limit 1;
  select count(distinct task.project_id), count(*)
  into project_count, source_count
  from public.tasks task where task.id = any(target_tasks);
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
    select new_task, user_id, auth.uid() from public.task_assignees where task_id = source.id;
    insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
    select new_task, assignee_id, auth.uid() from public.task_directory_assignees where task_id = source.id;

    id_map := id_map || jsonb_build_object(source.id::text, new_task::text);
    source_task := source.id; duplicated_task := new_task;
    return next;
  end loop;
end;
$$;

-- Atomic quick creation with the same multi-assignee model used by the full
-- task editor.
create or replace function public.create_task_with_assignees(
  target_project uuid,
  task_title text,
  task_section text,
  task_start date,
  task_due date,
  task_is_milestone boolean,
  target_users uuid[] default '{}'::uuid[],
  target_directory_assignees uuid[] default '{}'::uuid[],
  new_assignee_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_task uuid; remembered uuid; directory_ids uuid[] := coalesce(target_directory_assignees, '{}'::uuid[]);
begin
  new_task := public.create_task_with_details(
    target_project, task_title, task_section, task_start, task_due,
    task_is_milestone, '#2f7669', 'todo', null, null
  );
  if nullif(trim(new_assignee_name), '') is not null then
    remembered := public.remember_external_assignee(target_project, trim(new_assignee_name));
    directory_ids := array_append(directory_ids, remembered);
  end if;
  perform public.set_task_assignees(new_task, coalesce(target_users, '{}'::uuid[]), directory_ids);
  return new_task;
end;
$$;

create table if not exists public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  category text not null default 'general'
    check (category in ('general', 'meeting', 'progress', 'decision')),
  body text not null check (char_length(trim(body)) between 1 and 12000),
  linked_followup_id uuid references public.project_followups(id) on delete set null,
  linked_delay_id uuid references public.task_delay_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_notes_project_created_idx
  on public.project_notes(project_id, created_at desc);
create index if not exists project_notes_followup_idx
  on public.project_notes(linked_followup_id) where linked_followup_id is not null;
create index if not exists project_notes_delay_idx
  on public.project_notes(linked_delay_id) where linked_delay_id is not null;

create or replace function public.validate_project_note_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.linked_followup_id is not null and not exists (
    select 1 from public.project_followups followup
    where followup.id = new.linked_followup_id and followup.project_id = new.project_id
  ) then raise exception 'El pendiente vinculado no pertenece al proyecto'; end if;
  if new.linked_delay_id is not null and not exists (
    select 1 from public.task_delay_records delay
    join public.tasks task on task.id = delay.task_id
    where delay.id = new.linked_delay_id and task.project_id = new.project_id
  ) then raise exception 'El atraso vinculado no pertenece al proyecto'; end if;
  return new;
end;
$$;

drop trigger if exists validate_project_note_links_before_write on public.project_notes;
create trigger validate_project_note_links_before_write
before insert or update on public.project_notes
for each row execute function public.validate_project_note_links();

drop trigger if exists project_notes_updated on public.project_notes;
create trigger project_notes_updated
before update on public.project_notes
for each row execute function public.set_updated_at();

alter table public.project_notes enable row level security;
create policy "notes visible with project"
on public.project_notes for select
using (public.can_view_project(project_id));
create policy "project participants create notes"
on public.project_notes for insert
with check (author_id = auth.uid() and public.can_view_project(project_id));
create policy "authors update project notes"
on public.project_notes for update
using (author_id = auth.uid() and public.can_view_project(project_id))
with check (author_id = auth.uid() and public.can_view_project(project_id));
create policy "authors or editors delete project notes"
on public.project_notes for delete
using (author_id = auth.uid() or public.can_edit_project(project_id));

revoke all on function public.save_project_plan_order(uuid, text[], uuid[], text) from public;
revoke all on function public.duplicate_tasks(uuid[]) from public;
revoke all on function public.create_task_with_assignees(uuid, text, text, date, date, boolean, uuid[], uuid[], text) from public;
revoke all on function public.validate_project_note_links() from public;
grant execute on function public.save_project_plan_order(uuid, text[], uuid[], text) to authenticated;
grant execute on function public.duplicate_tasks(uuid[]) to authenticated;
grant execute on function public.create_task_with_assignees(uuid, text, text, date, date, boolean, uuid[], uuid[], text) to authenticated;

alter publication supabase_realtime add table public.project_notes;
notify pgrst, 'reload schema';
