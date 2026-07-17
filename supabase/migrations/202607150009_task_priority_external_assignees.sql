-- Orbit: reusable external assignees and task priority helpers.
-- Run this after 202607150008_project_statuses_privacy.sql.

create table if not exists public.project_external_assignees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index if not exists project_external_assignees_name_idx
  on public.project_external_assignees(project_id, lower(name));

alter table public.project_external_assignees enable row level security;
create policy "external assignees visible with project"
on public.project_external_assignees for select
using (public.can_view_project(project_id));
create policy "editors manage external assignees"
on public.project_external_assignees for all
using (public.can_edit_project(project_id))
with check (public.can_edit_project(project_id) and created_by = auth.uid());

create or replace function public.remember_external_assignee(target_project uuid, assignee_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare clean_name text := trim(assignee_name); result_id uuid;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar este proyecto';
  end if;
  if nullif(clean_name, '') is null or char_length(clean_name) > 120 then
    raise exception 'El nombre del responsable no es válido';
  end if;
  select id into result_id from public.project_external_assignees
  where project_id = target_project and lower(name) = lower(clean_name);
  if result_id is null then
    insert into public.project_external_assignees(project_id, name, created_by)
    values(target_project, clean_name, auth.uid()) returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.set_task_priority(target_task uuid, next_priority integer)
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
  if next_priority not between 1 and 3 then
    raise exception 'La prioridad debe ser baja, media o alta';
  end if;
  update public.tasks set priority = next_priority where id = target_task;
end;
$$;

-- Recover reusable names already entered in existing tasks.
insert into public.project_external_assignees(project_id, name, created_by)
select distinct t.project_id, trim(t.manual_assignee), p.created_by
from public.tasks t
join public.projects p on p.id = t.project_id
where nullif(trim(t.manual_assignee), '') is not null
on conflict do nothing;

revoke all on function public.remember_external_assignee(uuid, text) from public;
revoke all on function public.set_task_priority(uuid, integer) from public;
grant execute on function public.remember_external_assignee(uuid, text) to authenticated;
grant execute on function public.set_task_priority(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
