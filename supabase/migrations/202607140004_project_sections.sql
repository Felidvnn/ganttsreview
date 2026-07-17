-- Orbit: reusable project sections and section-aware project creation.
-- Run this after 202607140003_project_creation_rpc.sql.

create table if not exists public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  sort_order numeric(14,4) not null default 1000,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create unique index if not exists project_sections_name_unique_idx
  on public.project_sections (project_id, lower(name));
create index if not exists project_sections_project_sort_idx
  on public.project_sections (project_id, sort_order);

-- Recover sections already used by existing tasks.
insert into public.project_sections (project_id, name, sort_order, created_by)
select
  t.project_id,
  trim(t.section),
  row_number() over (partition by t.project_id order by min(t.sort_order), lower(trim(t.section))) * 1000,
  p.created_by
from public.tasks t
join public.projects p on p.id = t.project_id
where nullif(trim(t.section), '') is not null
group by t.project_id, trim(t.section), p.created_by
on conflict do nothing;

-- Every project should have at least one selectable section.
insert into public.project_sections (project_id, name, sort_order, created_by)
select p.id, 'General', 1000, p.created_by
from public.projects p
where not exists (
  select 1 from public.project_sections ps where ps.project_id = p.id
)
on conflict do nothing;

alter table public.project_sections enable row level security;

create policy "sections visible with project"
on public.project_sections for select
using (public.can_view_project(project_id));

create policy "editors create sections"
on public.project_sections for insert
with check (public.can_edit_project(project_id) and created_by = auth.uid());

create policy "editors update sections"
on public.project_sections for update
using (public.can_edit_project(project_id))
with check (public.can_edit_project(project_id));

create policy "editors delete sections"
on public.project_sections for delete
using (public.can_edit_project(project_id));

create or replace function public.add_project_section(
  target_project uuid,
  section_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(section_name);
  section_id uuid;
  next_order numeric(14,4);
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para modificar este proyecto';
  end if;
  if nullif(clean_name, '') is null or char_length(clean_name) > 100 then
    raise exception 'La sección debe tener entre 1 y 100 caracteres';
  end if;

  select id into section_id
  from public.project_sections
  where project_id = target_project and lower(name) = lower(clean_name);
  if section_id is not null then return section_id; end if;

  select coalesce(max(sort_order), 0) + 1000 into next_order
  from public.project_sections where project_id = target_project;

  insert into public.project_sections (project_id, name, sort_order, created_by)
  values (target_project, clean_name, next_order, auth.uid())
  returning id into section_id;
  return section_id;
end;
$$;

create or replace function public.create_project_with_sections(
  target_workspace uuid,
  project_name text,
  project_code text,
  project_description text,
  project_visibility public.project_visibility,
  project_start date,
  project_due date,
  section_names text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_project_id uuid;
  candidate text;
  added_count integer := 0;
begin
  if project_due is not null and project_start is not null and project_due < project_start then
    raise exception 'La fecha de término no puede ser anterior al inicio';
  end if;

  new_project_id := public.create_project(
    target_workspace,
    project_name,
    project_code,
    project_visibility
  );

  update public.projects
  set description = coalesce(trim(project_description), ''),
      start_date = project_start,
      due_date = project_due,
      baseline_start_date = project_start,
      baseline_due_date = project_due
  where id = new_project_id;

  if section_names is not null then
    foreach candidate in array section_names loop
      if nullif(trim(candidate), '') is not null then
        perform public.add_project_section(new_project_id, candidate);
        added_count := added_count + 1;
      end if;
    end loop;
  end if;

  if added_count = 0 then
    perform public.add_project_section(new_project_id, 'General');
  end if;

  return new_project_id;
end;
$$;

revoke all on function public.add_project_section(uuid, text) from public;
revoke all on function public.create_project_with_sections(uuid, text, text, text, public.project_visibility, date, date, text[]) from public;
grant execute on function public.add_project_section(uuid, text) to authenticated;
grant execute on function public.create_project_with_sections(uuid, text, text, text, public.project_visibility, date, date, text[]) to authenticated;

alter publication supabase_realtime add table public.project_sections;
notify pgrst, 'reload schema';

