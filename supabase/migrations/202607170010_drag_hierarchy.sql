-- Orbit: safe drag-and-drop task hierarchy changes.
-- Run this after 202607150009_task_priority_external_assignees.sql.

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
        select t.id from public.tasks t join descendants d on t.parent_id = d.id
      ) select 1 from descendants where id = new_parent
    ) then raise exception 'Esta relación crearía un ciclo'; end if;

    with recursive ancestors(id, parent_id, depth) as (
      select id, parent_id, 0 from public.tasks where id = new_parent
      union all
      select t.id, t.parent_id, a.depth + 1
      from public.tasks t join ancestors a on t.id = a.parent_id
    ) select coalesce(max(depth), 0) into parent_depth from ancestors;
    clean_section := parent_section;
  else
    clean_section := coalesce(nullif(trim(target_section), ''), clean_section, 'General');
  end if;

  with recursive descendants(id, depth) as (
    select target_task, 0
    union all
    select t.id, d.depth + 1
    from public.tasks t join descendants d on t.parent_id = d.id
  ) select coalesce(max(depth), 0) into subtree_depth from descendants;

  if parent_depth + 1 + subtree_depth > 2 then
    raise exception 'El movimiento superaría el límite de sub-subtareas';
  end if;

  update public.tasks set parent_id = new_parent where id = target_task;
  with recursive branch(id) as (
    select target_task
    union all
    select t.id from public.tasks t join branch b on t.parent_id = b.id
  )
  update public.tasks set section = clean_section where id in (select id from branch);
end;
$$;

revoke all on function public.move_task_in_hierarchy(uuid, uuid, text) from public;
grant execute on function public.move_task_in_hierarchy(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
