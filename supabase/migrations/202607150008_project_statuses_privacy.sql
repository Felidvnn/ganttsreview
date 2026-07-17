-- Orbit: configurable task states per project and explicit private-project privacy.
-- Run this after 202607140007_subtasks_followups.sql.

create table if not exists public.project_task_statuses (
  project_id uuid not null references public.projects(id) on delete cascade,
  status public.task_status not null,
  label text not null check (char_length(trim(label)) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  enabled boolean not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, status)
);

create index if not exists project_task_statuses_order_idx
  on public.project_task_statuses(project_id, enabled desc, sort_order);

create or replace function public.seed_project_task_statuses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_task_statuses(project_id, status, label, color, enabled, sort_order)
  values
    (new.id, 'todo', 'Pendiente', '#7A8781', true, 10),
    (new.id, 'progress', 'En curso', '#3778A6', true, 20),
    (new.id, 'review', 'En revisión', '#7F5AA6', true, 30),
    (new.id, 'blocked', 'Bloqueada', '#B64E4E', true, 40),
    (new.id, 'done', 'Completada', '#2F7669', true, 50)
  on conflict (project_id, status) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_project_task_statuses_after_project on public.projects;
create trigger seed_project_task_statuses_after_project
after insert on public.projects
for each row execute function public.seed_project_task_statuses();

insert into public.project_task_statuses(project_id, status, label, color, enabled, sort_order)
select p.id, defaults.status, defaults.label, defaults.color, true, defaults.sort_order
from public.projects p
cross join (values
  ('todo'::public.task_status, 'Pendiente', '#7A8781', 10),
  ('progress'::public.task_status, 'En curso', '#3778A6', 20),
  ('review'::public.task_status, 'En revisión', '#7F5AA6', 30),
  ('blocked'::public.task_status, 'Bloqueada', '#B64E4E', 40),
  ('done'::public.task_status, 'Completada', '#2F7669', 50)
) as defaults(status, label, color, sort_order)
on conflict (project_id, status) do nothing;

alter table public.project_task_statuses enable row level security;

create policy "statuses visible with project"
on public.project_task_statuses for select
using (public.can_view_project(project_id));

create policy "editors manage project statuses"
on public.project_task_statuses for all
using (public.can_edit_project(project_id))
with check (public.can_edit_project(project_id));

create trigger project_task_statuses_updated
before update on public.project_task_statuses
for each row execute function public.set_updated_at();

create or replace function public.configure_project_statuses(
  target_project uuid,
  status_configuration jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  state public.task_status;
  state_label text;
  state_color text;
  enabled_count integer := 0;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para configurar este proyecto';
  end if;
  if jsonb_typeof(status_configuration) <> 'array' then
    raise exception 'La configuración de estados no es válida';
  end if;

  for item in select value from jsonb_array_elements(status_configuration) loop
    state := (item ->> 'status')::public.task_status;
    state_label := trim(item ->> 'label');
    state_color := upper(item ->> 'color');
    if nullif(state_label, '') is null or char_length(state_label) > 40 then
      raise exception 'Cada estado debe tener un nombre de hasta 40 caracteres';
    end if;
    if state_color !~ '^#[0-9A-F]{6}$' then
      raise exception 'Uno de los colores no es válido';
    end if;
    if coalesce((item ->> 'enabled')::boolean, false) then
      enabled_count := enabled_count + 1;
    end if;

    insert into public.project_task_statuses(project_id, status, label, color, enabled, sort_order)
    values (
      target_project, state, state_label, state_color,
      coalesce((item ->> 'enabled')::boolean, false),
      coalesce((item ->> 'sortOrder')::smallint, 0)
    )
    on conflict (project_id, status) do update
    set label = excluded.label,
        color = excluded.color,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order;
  end loop;

  if enabled_count < 2 then
    raise exception 'Mantén al menos dos estados activos';
  end if;
end;
$$;

-- A leader sees the team's non-private projects. A private project remains visible
-- only to its creator and to people explicitly added as project members.
create or replace function public.can_view_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.projects p
    where p.id = target_project
      and public.is_workspace_member(p.workspace_id)
      and (
        p.created_by = auth.uid()
        or (public.is_workspace_leader(p.workspace_id) and p.visibility <> 'private')
        or p.visibility = 'workspace'
        or exists(
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.configure_project_statuses(uuid, jsonb) from public;
revoke all on function public.seed_project_task_statuses() from public;
grant execute on function public.configure_project_statuses(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
