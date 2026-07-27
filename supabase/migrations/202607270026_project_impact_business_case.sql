-- Orbit: optional project impact metrics and versioned business-case files.
-- Run this after 202607240025_independent_leader_visibility.sql.

alter table public.projects
  add column if not exists capturable_name text,
  add column if not exists capturable_reduction_percent numeric(5,2),
  add column if not exists hht_transformed numeric(12,2);

alter table public.projects
  drop constraint if exists projects_capturable_name_length,
  drop constraint if exists projects_capturable_reduction_range,
  drop constraint if exists projects_hht_transformed_nonnegative;

alter table public.projects
  add constraint projects_capturable_name_length check (
    capturable_name is null or char_length(trim(capturable_name)) between 1 and 120
  ),
  add constraint projects_capturable_reduction_range check (
    capturable_reduction_percent is null
    or capturable_reduction_percent between 0 and 100
  ),
  add constraint projects_hht_transformed_nonnegative check (
    hht_transformed is null or hht_transformed >= 0
  );

create or replace function public.update_project_impact(
  target_project uuid,
  capturable_label text default null,
  reduction_percent numeric default null,
  transformed_hht numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_capturable text := nullif(trim(capturable_label), '');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para editar este proyecto';
  end if;
  if clean_capturable is not null and char_length(clean_capturable) > 120 then
    raise exception 'El capturable debe tener hasta 120 caracteres';
  end if;
  if reduction_percent is not null and reduction_percent not between 0 and 100 then
    raise exception 'El porcentaje de reducción debe estar entre 0 y 100';
  end if;
  if transformed_hht is not null and transformed_hht < 0 then
    raise exception 'Las HHT no pueden ser negativas';
  end if;
  if clean_capturable is null then
    reduction_percent := null;
  end if;

  update public.projects
  set capturable_name = clean_capturable,
      capturable_reduction_percent = reduction_percent,
      hht_transformed = transformed_hht
  where id = target_project;
end;
$$;

create table if not exists public.project_business_case_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(trim(file_name)) between 1 and 240),
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null check (file_size between 1 and 26214400),
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists project_business_case_files_project_idx
  on public.project_business_case_files(project_id, uploaded_at desc);

alter table public.project_business_case_files enable row level security;

drop policy if exists "business cases visible with project" on public.project_business_case_files;
create policy "business cases visible with project"
on public.project_business_case_files for select
using (public.can_view_project(project_id));

drop policy if exists "editors add business case versions" on public.project_business_case_files;
create policy "editors add business case versions"
on public.project_business_case_files for insert
with check (
  public.can_edit_project(project_id)
  and uploaded_by = auth.uid()
  and split_part(storage_path, '/', 1) = project_id::text
);

-- The bucket is private. Files are versioned and there is deliberately no
-- update/delete policy: replacing a business case preserves previous versions.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-business-cases',
  'project-business-cases',
  false,
  26214400,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "business case files visible with project" on storage.objects;
create policy "business case files visible with project"
on storage.objects for select
using (
  bucket_id = 'project-business-cases'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_view_project(split_part(name, '/', 1)::uuid)
);

drop policy if exists "editors upload business case versions" on storage.objects;
create policy "editors upload business case versions"
on storage.objects for insert
with check (
  bucket_id = 'project-business-cases'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_edit_project(split_part(name, '/', 1)::uuid)
);

revoke all on function public.update_project_impact(uuid, text, numeric, numeric) from public;
grant execute on function public.update_project_impact(uuid, text, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
