-- Orbit: safe project section rename and deletion.
-- Run this after 202607200020_fix_bulk_task_copy_uuid.sql.

create or replace function public.rename_project_section(
  target_project uuid,
  current_name text,
  next_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  section_id uuid;
  clean_name text := trim(next_name);
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar las secciones';
  end if;
  if nullif(clean_name, '') is null or char_length(clean_name) > 100 then
    raise exception 'La sección debe tener entre 1 y 100 caracteres';
  end if;

  select section.id into section_id
  from public.project_sections section
  where section.project_id = target_project
    and lower(section.name) = lower(trim(current_name));
  if section_id is null then raise exception 'La sección ya no existe'; end if;

  if exists (
    select 1 from public.project_sections section
    where section.project_id = target_project
      and section.id <> section_id
      and lower(section.name) = lower(clean_name)
  ) then raise exception 'Ya existe una sección con ese nombre'; end if;

  update public.tasks
  set section = clean_name
  where project_id = target_project
    and lower(section) = lower(trim(current_name));

  update public.project_sections
  set name = clean_name
  where id = section_id;
end;
$$;

create or replace function public.delete_project_section(
  target_project uuid,
  section_name text,
  replacement_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  section_id uuid;
  canonical_replacement text;
  task_count integer;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar las secciones';
  end if;

  select section.id into section_id
  from public.project_sections section
  where section.project_id = target_project
    and lower(section.name) = lower(trim(section_name));
  if section_id is null then raise exception 'La sección ya no existe'; end if;

  if (select count(*) from public.project_sections where project_id = target_project) <= 1 then
    raise exception 'El proyecto debe mantener al menos una sección';
  end if;

  select count(*) into task_count
  from public.tasks
  where project_id = target_project
    and lower(section) = lower(trim(section_name));

  if task_count > 0 then
    select section.name into canonical_replacement
    from public.project_sections section
    where section.project_id = target_project
      and section.id <> section_id
      and lower(section.name) = lower(trim(replacement_name));
    if canonical_replacement is null then
      raise exception 'Selecciona otra sección para mover las tareas';
    end if;

    update public.tasks
    set section = canonical_replacement
    where project_id = target_project
      and lower(section) = lower(trim(section_name));
  end if;

  delete from public.project_sections where id = section_id;
end;
$$;

revoke all on function public.rename_project_section(uuid, text, text) from public;
revoke all on function public.delete_project_section(uuid, text, text) from public;
grant execute on function public.rename_project_section(uuid, text, text) to authenticated;
grant execute on function public.delete_project_section(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
