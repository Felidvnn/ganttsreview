-- Orbit: one additional task hierarchy level and atomic bulk moves.
-- Run this after 202607200022_project_note_mentions.sql.

-- Root tasks may now contain three nested generations (depths 1, 2 and 3).
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
  if parent_project <> new.project_id then raise exception 'Las tareas anidadas deben pertenecer al mismo proyecto'; end if;

  with recursive ancestors(id, parent_id, depth) as (
    select id, parent_id, 1 from public.tasks where id = new.parent_id
    union all
    select task.id, task.parent_id, ancestor.depth + 1
    from public.tasks task
    join ancestors ancestor on task.id = ancestor.parent_id
  )
  select coalesce(max(depth), 0) into ancestor_count from ancestors;

  if ancestor_count > 3 then
    raise exception 'La jerarquía admite un máximo de tres niveles bajo la tarea principal';
  end if;

  if exists (
    with recursive descendants(id) as (
      select id from public.tasks where parent_id = new.id
      union all
      select task.id
      from public.tasks task
      join descendants descendant on task.parent_id = descendant.id
    )
    select 1 from descendants where id = new.parent_id
  ) then raise exception 'Esta relación crearía un ciclo en la jerarquía'; end if;
  return new;
end;
$$;

create or replace function public.move_task_in_hierarchy(
  target_task uuid,
  new_parent uuid default null,
  target_section text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_project uuid;
  parent_project uuid;
  parent_section text;
  clean_section text;
  parent_depth integer := -1;
  subtree_depth integer := 0;
begin
  select project_id, section into task_project, clean_section
  from public.tasks where id = target_task;

  if task_project is null or not public.can_edit_project(task_project) then
    raise exception 'No tienes permisos para reorganizar esta tarea';
  end if;
  if new_parent = target_task then
    raise exception 'Una tarea no puede depender de sí misma';
  end if;

  if new_parent is not null then
    select project_id, section into parent_project, parent_section
    from public.tasks where id = new_parent;
    if parent_project is null or parent_project <> task_project then
      raise exception 'La tarea padre debe pertenecer al mismo proyecto';
    end if;
    if exists (
      with recursive descendants(id) as (
        select id from public.tasks where parent_id = target_task
        union all
        select task.id
        from public.tasks task
        join descendants descendant on task.parent_id = descendant.id
      )
      select 1 from descendants where id = new_parent
    ) then raise exception 'Esta relación crearía un ciclo'; end if;

    with recursive ancestors(id, parent_id, depth) as (
      select id, parent_id, 0 from public.tasks where id = new_parent
      union all
      select task.id, task.parent_id, ancestor.depth + 1
      from public.tasks task
      join ancestors ancestor on task.id = ancestor.parent_id
    )
    select coalesce(max(depth), 0) into parent_depth from ancestors;
    clean_section := parent_section;
  else
    clean_section := coalesce(nullif(trim(target_section), ''), clean_section, 'General');
  end if;

  with recursive descendants(id, depth) as (
    select target_task, 0
    union all
    select task.id, descendant.depth + 1
    from public.tasks task
    join descendants descendant on task.parent_id = descendant.id
  )
  select coalesce(max(depth), 0) into subtree_depth from descendants;

  if parent_depth + 1 + subtree_depth > 3 then
    raise exception 'El movimiento superaría el límite de jerarquía';
  end if;

  update public.tasks set parent_id = new_parent where id = target_task;
  with recursive branch(id) as (
    select target_task
    union all
    select task.id
    from public.tasks task
    join branch parent on task.parent_id = parent.id
  )
  update public.tasks set section = clean_section where id in (select id from branch);
end;
$$;

-- Only selected roots are moved. If a parent and its children are selected,
-- their internal hierarchy is preserved and the complete branch moves once.
create or replace function public.move_tasks_in_hierarchy(
  target_tasks uuid[],
  new_parent uuid default null,
  target_section text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project uuid;
  selected_count integer;
  source_count integer;
  project_count integer;
  root_task uuid;
  moved_count integer := 0;
begin
  if target_tasks is null or cardinality(target_tasks) = 0 then
    raise exception 'Selecciona al menos una tarea';
  end if;

  select task.project_id into target_project
  from public.tasks task
  where task.id = any(target_tasks)
  limit 1;

  select count(distinct selected.id) into selected_count
  from unnest(target_tasks) selected(id);

  select count(*), count(distinct task.project_id)
  into source_count, project_count
  from public.tasks task
  where task.id = any(target_tasks);

  if source_count <> selected_count or project_count <> 1 then
    raise exception 'Todas las tareas deben existir y pertenecer al mismo proyecto';
  end if;
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para reorganizar estas tareas';
  end if;
  if new_parent = any(target_tasks) then
    raise exception 'La tarea de destino no puede formar parte de la selección';
  end if;

  for root_task in
    select task.id
    from public.tasks task
    where task.id = any(target_tasks)
      and not exists (
        with recursive ancestors(id, parent_id) as (
          select parent.id, parent.parent_id
          from public.tasks parent
          where parent.id = task.parent_id
          union all
          select parent.id, parent.parent_id
          from public.tasks parent
          join ancestors ancestor on parent.id = ancestor.parent_id
        )
        select 1 from ancestors where id = any(target_tasks)
      )
    order by task.sort_order, task.created_at
  loop
    perform public.move_task_in_hierarchy(root_task, new_parent, target_section);
    moved_count := moved_count + 1;
  end loop;

  return moved_count;
end;
$$;

-- Excel imports follow the same four-level hierarchy.
create or replace function public.import_project_tasks(target_project uuid, task_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  task_ids jsonb := '{}'::jsonb;
  new_id uuid;
  parent_task uuid;
  type_id uuid;
  directory_id uuid;
  clean_title text;
  clean_section text;
  clean_ref text;
  parent_ref text;
  type_name text;
  owner_name text;
  start_value date;
  due_value date;
  actual_value date;
  row_count integer := 0;
  parent_depth integer;
  row_status public.task_status;
begin
  if not public.can_edit_project(target_project) then raise exception 'No tienes permisos para importar tareas'; end if;
  if task_rows is null or jsonb_typeof(task_rows) <> 'array' then raise exception 'La plantilla no contiene tareas válidas'; end if;

  for item in select value from jsonb_array_elements(task_rows) loop
    row_count := row_count + 1;
    clean_title := trim(item ->> 'title');
    if nullif(clean_title, '') is null then raise exception 'La fila % no tiene nombre', row_count; end if;
    clean_ref := coalesce(nullif(trim(item ->> 'ref'), ''), row_count::text);
    if task_ids ? clean_ref then raise exception 'El identificador % está repetido', clean_ref; end if;

    parent_ref := nullif(trim(item ->> 'parentRef'), '');
    parent_task := null;
    if parent_ref is not null then
      if not (task_ids ? parent_ref) then raise exception 'La tarea padre % debe aparecer antes que su tarea anidada', parent_ref; end if;
      parent_task := (task_ids ->> parent_ref)::uuid;
      with recursive ancestors(id, parent_id, depth) as (
        select id, parent_id, 0 from public.tasks where id = parent_task
        union all
        select task.id, task.parent_id, ancestor.depth + 1
        from public.tasks task
        join ancestors ancestor on task.id = ancestor.parent_id
      )
      select coalesce(max(depth), 0) into parent_depth from ancestors;
      if parent_depth >= 3 then raise exception 'La fila % supera el límite de jerarquía', row_count; end if;
    end if;

    clean_section := coalesce(nullif(trim(item ->> 'section'), ''), 'General');
    perform public.add_project_section(target_project, clean_section);
    type_name := coalesce(nullif(trim(item ->> 'type'), ''), case when coalesce((item ->> 'milestone')::boolean, false) then 'Hito' else 'Tarea' end);
    select id into type_id from public.project_task_types where project_id = target_project and lower(name) = lower(type_name) limit 1;
    if type_id is null then
      insert into public.project_task_types(project_id, name, color, sort_order)
      values(target_project, type_name, '#6B7D75', 100 + row_count)
      returning id into type_id;
    end if;

    begin start_value := nullif(item ->> 'startDate', '')::date; exception when others then raise exception 'Fecha de inicio inválida en fila %', row_count; end;
    begin due_value := nullif(item ->> 'dueDate', '')::date; exception when others then raise exception 'Fecha de término inválida en fila %', row_count; end;
    begin actual_value := nullif(item ->> 'actualDate', '')::date; exception when others then raise exception 'Fecha real inválida en fila %', row_count; end;
    begin row_status := coalesce(nullif(item ->> 'status', '')::public.task_status, 'todo'); exception when others then row_status := 'todo'; end;

    insert into public.tasks(
      project_id, parent_id, title, description, section, status, priority,
      start_date, due_date, baseline_start_date, baseline_due_date, progress,
      sort_order, is_milestone, created_by, color, actual_completion_date, task_type_id
    )
    values(
      target_project, parent_task, clean_title, coalesce(item ->> 'description', ''), clean_section, row_status,
      least(3, greatest(1, coalesce((item ->> 'priority')::integer, 2))),
      start_value, due_value, start_value, due_value,
      least(100, greatest(0, coalesce((item ->> 'progress')::integer, case when row_status = 'done' then 100 else 0 end))),
      row_count * 10, coalesce((item ->> 'milestone')::boolean, false), auth.uid(),
      coalesce(nullif(item ->> 'color', ''), '#2f7669'), actual_value, type_id
    )
    returning id into new_id;

    task_ids := task_ids || jsonb_build_object(clean_ref, new_id::text);
    owner_name := nullif(trim(item ->> 'owner'), '');
    if owner_name is not null then
      directory_id := public.remember_external_assignee(target_project, owner_name);
      insert into public.task_directory_assignees(task_id, assignee_id, assigned_by)
      values(new_id, directory_id, auth.uid())
      on conflict do nothing;
      update public.tasks set manual_assignee = owner_name where id = new_id;
    end if;
  end loop;
  return row_count;
end;
$$;

revoke all on function public.move_tasks_in_hierarchy(uuid[], uuid, text) from public;
grant execute on function public.move_tasks_in_hierarchy(uuid[], uuid, text) to authenticated;

notify pgrst, 'reload schema';
