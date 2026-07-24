-- Orbit: safe project detail editing.
-- Run this after 202607230023_bulk_hierarchy_move.sql.
--
-- Project health is calculated in the application from the current task plan.
-- This migration intentionally preserves the legacy projects.health value and
-- every project baseline, task, note and audit record.

create or replace function public.update_project_details(
  target_project uuid,
  project_name text,
  project_start date,
  project_due date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(project_name);
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para editar este proyecto';
  end if;
  if nullif(clean_name, '') is null or char_length(clean_name) > 160 then
    raise exception 'El nombre debe tener entre 1 y 160 caracteres';
  end if;
  if project_start is not null and project_due is not null and project_due < project_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;

  update public.projects
  set name = clean_name,
      start_date = project_start,
      due_date = project_due
  where id = target_project;
end;
$$;

revoke all on function public.update_project_details(uuid, text, date, date) from public;
grant execute on function public.update_project_details(uuid, text, date, date) to authenticated;

notify pgrst, 'reload schema';
