-- Orbit: flexible scheduling warnings, configurable task types and Excel project import.
-- Run this after 202607200017_optional_actual_completion_date.sql.

-- Date inconsistencies are now planning warnings, not database errors. This lets
-- users correct either endpoint in any order while the UI keeps the row marked.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.tasks'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%due_date%'
      and pg_get_constraintdef(con.oid) ilike '%start_date%'
  loop
    execute format('alter table public.tasks drop constraint %I', constraint_name);
  end loop;
end $$;

create table if not exists public.project_task_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 50),
  color text not null default '#6B7D75' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_task_types_name_idx
  on public.project_task_types(project_id, lower(name));
create index if not exists project_task_types_order_idx
  on public.project_task_types(project_id, sort_order, name);

alter table public.tasks
  add column if not exists task_type_id uuid references public.project_task_types(id) on delete set null;
create index if not exists tasks_task_type_idx on public.tasks(task_type_id);

alter table public.project_task_types enable row level security;
create policy "task types visible with project"
on public.project_task_types for select
using (public.can_view_project(project_id));
create policy "editors manage task types"
on public.project_task_types for all
using (public.can_edit_project(project_id))
with check (public.can_edit_project(project_id));

drop trigger if exists project_task_types_updated on public.project_task_types;
create trigger project_task_types_updated
before update on public.project_task_types
for each row execute function public.set_updated_at();

create or replace function public.seed_project_task_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_task_types(project_id, name, color, sort_order)
  values
    (new.id, 'Tarea', '#47766A', 10),
    (new.id, 'Proceso', '#3D78A3', 20),
    (new.id, 'Reunión', '#8264A5', 30),
    (new.id, 'Entregable', '#B2763D', 40),
    (new.id, 'Hito', '#B5504B', 50)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists seed_project_task_types_after_project on public.projects;
create trigger seed_project_task_types_after_project
after insert on public.projects
for each row execute function public.seed_project_task_types();

insert into public.project_task_types(project_id, name, color, sort_order)
select project.id, defaults.name, defaults.color, defaults.sort_order
from public.projects project
cross join (values
  ('Tarea', '#47766A', 10),
  ('Proceso', '#3D78A3', 20),
  ('Reunión', '#8264A5', 30),
  ('Entregable', '#B2763D', 40),
  ('Hito', '#B5504B', 50)
) defaults(name, color, sort_order)
on conflict do nothing;

update public.tasks task
set task_type_id = type.id
from public.project_task_types type
where type.project_id = task.project_id
  and lower(type.name) = case when task.is_milestone then 'hito' else 'tarea' end
  and task.task_type_id is null;

create or replace function public.assign_default_task_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_type_id is null then
    select id into new.task_type_id
    from public.project_task_types
    where project_id = new.project_id
      and lower(name) = case when coalesce(new.is_milestone, false) then 'hito' else 'tarea' end
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_default_task_type_before_task on public.tasks;
create trigger assign_default_task_type_before_task
before insert on public.tasks
for each row execute function public.assign_default_task_type();

create or replace function public.configure_project_task_types(
  target_project uuid,
  type_configuration jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  clean_name text;
  clean_color text;
  keep_ids uuid[] := '{}'::uuid[];
begin
  if not public.can_edit_project(target_project) then
    raise exception 'No tienes permisos para configurar este proyecto';
  end if;
  if jsonb_typeof(type_configuration) <> 'array' or jsonb_array_length(type_configuration) < 1 then
    raise exception 'Mantén al menos un tipo de tarea';
  end if;

  for item in select value from jsonb_array_elements(type_configuration) loop
    clean_name := trim(item ->> 'name');
    clean_color := upper(coalesce(item ->> 'color', '#6B7D75'));
    if nullif(clean_name, '') is null or char_length(clean_name) > 50 then
      raise exception 'Cada tipo debe tener un nombre de hasta 50 caracteres';
    end if;
    if clean_color !~ '^#[0-9A-F]{6}$' then raise exception 'Uno de los colores no es válido'; end if;
    begin item_id := nullif(item ->> 'id', '')::uuid; exception when invalid_text_representation then item_id := null; end;

    if item_id is not null and exists (
      select 1 from public.project_task_types where id = item_id and project_id = target_project
    ) then
      update public.project_task_types
      set name = clean_name, color = clean_color,
          sort_order = coalesce((item ->> 'sortOrder')::smallint, 0)
      where id = item_id;
    else
      select id into item_id from public.project_task_types
      where project_id = target_project and lower(name) = lower(clean_name);
      if item_id is null then
        insert into public.project_task_types(project_id, name, color, sort_order)
        values(target_project, clean_name, clean_color, coalesce((item ->> 'sortOrder')::smallint, 0))
        returning id into item_id;
      else
        update public.project_task_types
        set color = clean_color, sort_order = coalesce((item ->> 'sortOrder')::smallint, 0)
        where id = item_id;
      end if;
    end if;
    keep_ids := array_append(keep_ids, item_id);
  end loop;

  delete from public.project_task_types
  where project_id = target_project and not (id = any(keep_ids));
end;
$$;

create or replace function public.set_task_type(target_task uuid, next_type uuid)
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
  if next_type is not null and not exists (
    select 1 from public.project_task_types where id = next_type and project_id = target_project
  ) then raise exception 'El tipo no pertenece a este proyecto'; end if;
  update public.tasks set task_type_id = next_type where id = target_task;
end;
$$;

-- Existing scheduling functions now accept provisional inconsistencies. The UI
-- highlights them until either endpoint is corrected.
create or replace function public.update_task_schedule(target_task uuid, task_start date, task_due date)
returns void language plpgsql security definer set search_path = '' as $$
declare target_project uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then raise exception 'No tienes permisos para reprogramar esta tarea'; end if;
  update public.tasks set start_date = task_start, due_date = task_due where id = target_task;
end;
$$;

create or replace function public.update_task_dates(target_task uuid, task_start date, task_due date, task_actual date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target_project uuid;
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then raise exception 'No tienes permisos para cambiar las fechas de esta tarea'; end if;
  update public.tasks
  set start_date = task_start,
      due_date = task_due,
      actual_completion_date = task_actual,
      status = case when task_actual is not null then 'done'::public.task_status else status end,
      progress = case when task_actual is not null then 100 else progress end,
      completed_at = case when task_actual is not null then coalesce(completed_at, task_actual::timestamp with time zone) else completed_at end
  where id = target_task;
end;
$$;

create or replace function public.update_task_details(
  target_task uuid, task_title text, task_description text, task_section text,
  task_start date, task_due date, task_status public.task_status, task_progress integer,
  task_is_milestone boolean, task_color text, target_assignee uuid, assignee_label text
)
returns void language plpgsql security definer set search_path = '' as $$
declare target_project uuid; clean_section text := coalesce(nullif(trim(task_section), ''), 'General'); clean_color text := coalesce(task_color, '#2f7669');
begin
  select project_id into target_project from public.tasks where id = target_task;
  if target_project is null or not public.can_edit_project(target_project) then raise exception 'No tienes permisos para modificar esta tarea'; end if;
  if nullif(trim(task_title), '') is null then raise exception 'La tarea debe tener un nombre'; end if;
  if task_progress < 0 or task_progress > 100 then raise exception 'El avance debe estar entre 0 y 100'; end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color no es válido'; end if;
  perform public.add_project_section(target_project, clean_section);
  update public.tasks set title = trim(task_title), description = coalesce(trim(task_description), ''), section = clean_section,
    start_date = task_start, due_date = task_due,
    status = case when task_progress = 100 or task_status = 'done' then 'done'::public.task_status else task_status end,
    progress = case when task_status = 'done' then 100 else task_progress end,
    is_milestone = coalesce(task_is_milestone, false), color = clean_color,
    completed_at = case when task_progress = 100 or task_status = 'done' then coalesce(completed_at, now()) else null end
  where id = target_task;
  perform public.set_task_owner(target_task, target_assignee, assignee_label);
end;
$$;

create or replace function public.create_subtask(target_parent uuid, task_title text, task_start date, task_due date, target_assignee uuid, assignee_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare parent_task public.tasks%rowtype; new_task_id uuid; next_order numeric(14,4);
begin
  select * into parent_task from public.tasks where id = target_parent;
  if parent_task.id is null or not public.can_edit_project(parent_task.project_id) then raise exception 'No tienes permisos para agregar subtareas'; end if;
  if nullif(trim(task_title), '') is null then raise exception 'La subtarea debe tener un nombre'; end if;
  select coalesce(max(sort_order), parent_task.sort_order) + 10 into next_order from public.tasks where project_id = parent_task.project_id;
  insert into public.tasks(project_id,parent_id,title,section,status,priority,start_date,due_date,baseline_start_date,baseline_due_date,progress,sort_order,color,created_by)
  values(parent_task.project_id,target_parent,trim(task_title),parent_task.section,'todo',parent_task.priority,task_start,task_due,task_start,task_due,0,next_order,parent_task.color,auth.uid())
  returning id into new_task_id;
  perform public.set_task_owner(new_task_id, target_assignee, assignee_label);
  return new_task_id;
end;
$$;

create or replace function public.create_task_with_details(
  target_project uuid, task_title text, task_section text, task_start date, task_due date,
  task_is_milestone boolean, task_color text, task_status public.task_status,
  target_assignee uuid, assignee_label text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_task_id uuid; target_workspace uuid; clean_color text := coalesce(task_color, '#2f7669');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if not public.can_edit_project(target_project) then raise exception 'No tienes permisos para editar este proyecto'; end if;
  if nullif(trim(task_title), '') is null then raise exception 'La tarea debe tener un nombre'; end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color no es válido'; end if;
  perform public.add_project_section(target_project, coalesce(nullif(trim(task_section), ''), 'General'));
  select workspace_id into target_workspace from public.projects where id = target_project;
  if target_assignee is not null and not exists (
    select 1 from public.projects project
    where project.id = target_project and (
      project.created_by = target_assignee
      or exists (select 1 from public.workspace_members member where member.workspace_id = target_workspace and member.user_id = target_assignee)
      or exists (select 1 from public.project_members member where member.project_id = target_project and member.user_id = target_assignee)
    )
  ) then raise exception 'El responsable no tiene acceso al proyecto'; end if;
  insert into public.tasks(project_id,title,section,start_date,due_date,is_milestone,color,status,progress,manual_assignee,created_by,completed_at)
  values(target_project,trim(task_title),coalesce(nullif(trim(task_section), ''),'General'),task_start,task_due,coalesce(task_is_milestone,false),clean_color,
    coalesce(task_status,'todo'),case when task_status='done' then 100 else 0 end,
    case when target_assignee is null then nullif(trim(assignee_label),'') else null end,auth.uid(),case when task_status='done' then now() else null end)
  returning id into new_task_id;
  if target_assignee is not null then insert into public.task_assignees(task_id,user_id,assigned_by) values(new_task_id,target_assignee,auth.uid()); end if;
  return new_task_id;
end;
$$;

create or replace function public.import_project_tasks(target_project uuid, task_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; task_ids jsonb := '{}'::jsonb; new_id uuid; parent_task uuid; type_id uuid; directory_id uuid;
  clean_title text; clean_section text; clean_ref text; parent_ref text; type_name text; owner_name text;
  start_value date; due_value date; actual_value date; row_count integer := 0; row_status public.task_status;
begin
  if not public.can_edit_project(target_project) then raise exception 'No tienes permisos para importar tareas'; end if;
  if task_rows is null or jsonb_typeof(task_rows) <> 'array' then raise exception 'La plantilla no contiene tareas válidas'; end if;
  for item in select value from jsonb_array_elements(task_rows) loop
    row_count := row_count + 1;
    clean_title := trim(item ->> 'title');
    if nullif(clean_title, '') is null then raise exception 'La fila % no tiene nombre', row_count; end if;
    clean_ref := coalesce(nullif(trim(item ->> 'ref'), ''), row_count::text);
    if task_ids ? clean_ref then raise exception 'El identificador % está repetido', clean_ref; end if;
    parent_ref := nullif(trim(item ->> 'parentRef'), ''); parent_task := null;
    if parent_ref is not null then
      if not (task_ids ? parent_ref) then raise exception 'La tarea padre % debe aparecer antes que su subtarea', parent_ref; end if;
      parent_task := (task_ids ->> parent_ref)::uuid;
      if exists(select 1 from public.tasks parent join public.tasks grandparent on grandparent.id=parent.parent_id where parent.id=parent_task and grandparent.parent_id is not null) then
        raise exception 'La fila % supera el límite de sub-subtareas', row_count;
      end if;
    end if;
    clean_section := coalesce(nullif(trim(item ->> 'section'), ''), 'General'); perform public.add_project_section(target_project, clean_section);
    type_name := coalesce(nullif(trim(item ->> 'type'), ''), case when coalesce((item ->> 'milestone')::boolean,false) then 'Hito' else 'Tarea' end);
    select id into type_id from public.project_task_types where project_id=target_project and lower(name)=lower(type_name) limit 1;
    if type_id is null then
      insert into public.project_task_types(project_id,name,color,sort_order)
      values(target_project,type_name,'#6B7D75',100 + row_count) returning id into type_id;
    end if;
    begin start_value := nullif(item ->> 'startDate','')::date; exception when others then raise exception 'Fecha de inicio inválida en fila %', row_count; end;
    begin due_value := nullif(item ->> 'dueDate','')::date; exception when others then raise exception 'Fecha de término inválida en fila %', row_count; end;
    begin actual_value := nullif(item ->> 'actualDate','')::date; exception when others then raise exception 'Fecha real inválida en fila %', row_count; end;
    begin row_status := coalesce(nullif(item ->> 'status','')::public.task_status,'todo'); exception when others then row_status := 'todo'; end;
    insert into public.tasks(project_id,parent_id,title,description,section,status,priority,start_date,due_date,baseline_start_date,baseline_due_date,progress,sort_order,is_milestone,created_by,color,actual_completion_date,task_type_id)
    values(target_project,parent_task,clean_title,coalesce(item ->> 'description',''),clean_section,row_status,
      least(3,greatest(1,coalesce((item ->> 'priority')::integer,2))),start_value,due_value,start_value,due_value,
      least(100,greatest(0,coalesce((item ->> 'progress')::integer,case when row_status='done' then 100 else 0 end))),row_count*10,
      coalesce((item ->> 'milestone')::boolean,false),auth.uid(),coalesce(nullif(item ->> 'color',''),'#2f7669'),actual_value,type_id)
    returning id into new_id;
    task_ids := task_ids || jsonb_build_object(clean_ref,new_id::text);
    owner_name := nullif(trim(item ->> 'owner'), '');
    if owner_name is not null then
      directory_id := public.remember_external_assignee(target_project,owner_name);
      insert into public.task_directory_assignees(task_id,assignee_id,assigned_by) values(new_id,directory_id,auth.uid()) on conflict do nothing;
      update public.tasks set manual_assignee=owner_name where id=new_id;
    end if;
  end loop;
  return row_count;
end;
$$;

create or replace function public.create_project_from_template(
  target_workspace uuid, project_name text, project_code text, project_description text,
  project_visibility public.project_visibility, project_start date, project_due date,
  section_names text[], task_rows jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_project uuid;
begin
  new_project := public.create_project_with_sections(target_workspace,project_name,project_code,project_description,project_visibility,project_start,project_due,section_names);
  perform public.import_project_tasks(new_project,task_rows);
  return new_project;
end;
$$;

-- Preserve the configured type when duplicating a task.
create or replace function public.duplicate_task(target_task uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare source public.tasks%rowtype; new_task_id uuid; next_order numeric(14,4);
begin
  select * into source from public.tasks where id = target_task;
  if source.id is null or not public.can_edit_project(source.project_id) then raise exception 'No tienes permisos para duplicar esta tarea'; end if;
  select coalesce(max(sort_order),0)+10 into next_order from public.tasks where project_id=source.project_id;
  insert into public.tasks(project_id,parent_id,title,description,section,status,priority,start_date,due_date,baseline_start_date,baseline_due_date,progress,sort_order,is_milestone,created_by,completed_at,color,manual_assignee,rollup_progress,actual_completion_date,task_type_id)
  values(source.project_id,source.parent_id,'Copia de '||source.title,source.description,source.section,'todo',source.priority,source.start_date,source.due_date,source.start_date,source.due_date,0,next_order,source.is_milestone,auth.uid(),null,source.color,source.manual_assignee,false,null,source.task_type_id)
  returning id into new_task_id;
  insert into public.task_assignees(task_id,user_id,assigned_by) select new_task_id,user_id,auth.uid() from public.task_assignees where task_id=target_task;
  insert into public.task_directory_assignees(task_id,assignee_id,assigned_by) select new_task_id,assignee_id,auth.uid() from public.task_directory_assignees where task_id=target_task;
  return new_task_id;
end;
$$;

revoke all on function public.configure_project_task_types(uuid,jsonb) from public;
revoke all on function public.set_task_type(uuid,uuid) from public;
revoke all on function public.import_project_tasks(uuid,jsonb) from public;
revoke all on function public.create_project_from_template(uuid,text,text,text,public.project_visibility,date,date,text[],jsonb) from public;
revoke all on function public.seed_project_task_types() from public;
revoke all on function public.assign_default_task_type() from public;
grant execute on function public.configure_project_task_types(uuid,jsonb) to authenticated;
grant execute on function public.set_task_type(uuid,uuid) to authenticated;
grant execute on function public.import_project_tasks(uuid,jsonb) to authenticated;
grant execute on function public.create_project_from_template(uuid,text,text,text,public.project_visibility,date,date,text[],jsonb) to authenticated;

notify pgrst, 'reload schema';
