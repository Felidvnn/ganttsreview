-- Orbit: collaborative project planning schema
create extension if not exists pgcrypto;

create type public.organization_role as enum ('leader', 'engineer');
create type public.project_permission as enum ('owner', 'editor', 'viewer');
create type public.project_visibility as enum ('private', 'shared', 'workspace');
create type public.project_health as enum ('healthy', 'risk', 'delayed', 'paused', 'completed');
create type public.task_status as enum ('todo', 'progress', 'review', 'done', 'blocked');
create type public.dependency_type as enum ('finish_start', 'start_start', 'finish_finish', 'start_finish');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  job_title text,
  timezone text not null default 'America/Santiago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'engineer',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  code text not null,
  description text not null default '',
  visibility public.project_visibility not null default 'private',
  health public.project_health not null default 'healthy',
  color text not null default '#2f7669',
  start_date date,
  due_date date,
  baseline_start_date date,
  baseline_due_date date,
  progress smallint not null default 0 check (progress between 0 and 100),
  created_by uuid not null references public.profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission public.project_permission not null default 'viewer',
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  description text not null default '',
  section text not null default 'General',
  status public.task_status not null default 'todo',
  priority smallint not null default 2 check (priority between 0 and 3),
  start_date date,
  due_date date,
  baseline_start_date date,
  baseline_due_date date,
  progress smallint not null default 0 check (progress between 0 and 100),
  sort_order numeric(14,4) not null default 1000,
  is_milestone boolean not null default false,
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_task_id uuid not null references public.tasks(id) on delete cascade,
  successor_task_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type public.dependency_type not null default 'finish_start',
  lag_days integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (predecessor_task_id, successor_task_id),
  check (predecessor_task_id <> successor_task_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 5000),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.weekly_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  week_start date not null,
  due_date date,
  completed_at timestamptz,
  carryover_reason text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index projects_workspace_idx on public.projects(workspace_id) where archived_at is null;
create index tasks_project_sort_idx on public.tasks(project_id, sort_order);
create index tasks_due_open_idx on public.tasks(due_date) where status <> 'done';
create index dependencies_successor_idx on public.task_dependencies(successor_task_id);
create index audit_workspace_created_idx on public.audit_logs(workspace_id, created_at desc);
create index weekly_user_week_idx on public.weekly_items(user_id, week_start);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger workspaces_updated before update on public.workspaces for each row execute function public.set_updated_at();
create trigger projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Security-definer helpers prevent recursive RLS checks on membership tables.
create or replace function public.is_workspace_member(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid());
$$;
create or replace function public.is_workspace_leader(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and role = 'leader');
$$;
create or replace function public.can_view_project(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.projects p
    where p.id = target_project and (
      p.created_by = auth.uid()
      or (p.visibility = 'workspace' and public.is_workspace_member(p.workspace_id))
      or exists(select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid())
    )
  );
$$;
create or replace function public.can_edit_project(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.projects p
    where p.id = target_project and (
      p.created_by = auth.uid()
      or public.is_workspace_leader(p.workspace_id)
      or exists(select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid() and pm.permission in ('owner','editor'))
    )
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.comments enable row level security;
alter table public.weekly_items enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles visible to colleagues" on public.profiles for select using (
  id = auth.uid() or exists(select 1 from public.workspace_members mine join public.workspace_members theirs using (workspace_id) where mine.user_id = auth.uid() and theirs.user_id = profiles.id)
);
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "members view workspaces" on public.workspaces for select using (public.is_workspace_member(id));
create policy "authenticated create workspaces" on public.workspaces for insert to authenticated with check (created_by = auth.uid());
create policy "leaders update workspaces" on public.workspaces for update using (public.is_workspace_leader(id));
create policy "members view membership" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy "leaders manage membership" on public.workspace_members for all using (public.is_workspace_leader(workspace_id)) with check (public.is_workspace_leader(workspace_id));
create policy "project access" on public.projects for select using (public.can_view_project(id));
create policy "members create projects" on public.projects for insert with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "editors update projects" on public.projects for update using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy "owners delete projects" on public.projects for delete using (created_by = auth.uid() or public.is_workspace_leader(workspace_id));
create policy "project members visible" on public.project_members for select using (public.can_view_project(project_id));
create policy "project owners manage members" on public.project_members for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy "tasks visible with project" on public.tasks for select using (public.can_view_project(project_id));
create policy "editors create tasks" on public.tasks for insert with check (public.can_edit_project(project_id) and created_by = auth.uid());
create policy "editors update tasks" on public.tasks for update using (public.can_edit_project(project_id));
create policy "editors delete tasks" on public.tasks for delete using (public.can_edit_project(project_id));
create policy "assignees visible with task" on public.task_assignees for select using (exists(select 1 from public.tasks t where t.id = task_id and public.can_view_project(t.project_id)));
create policy "editors manage assignees" on public.task_assignees for all using (exists(select 1 from public.tasks t where t.id = task_id and public.can_edit_project(t.project_id))) with check (exists(select 1 from public.tasks t where t.id = task_id and public.can_edit_project(t.project_id)));
create policy "dependencies visible" on public.task_dependencies for select using (exists(select 1 from public.tasks t where t.id = predecessor_task_id and public.can_view_project(t.project_id)) and exists(select 1 from public.tasks t where t.id = successor_task_id and public.can_view_project(t.project_id)));
create policy "editors manage dependencies" on public.task_dependencies for all using (exists(select 1 from public.tasks t where t.id = successor_task_id and public.can_edit_project(t.project_id))) with check (exists(select 1 from public.tasks t where t.id = successor_task_id and public.can_edit_project(t.project_id)));
create policy "comments visible with task" on public.comments for select using (exists(select 1 from public.tasks t where t.id = task_id and public.can_view_project(t.project_id)));
create policy "members add comments" on public.comments for insert with check (author_id = auth.uid() and exists(select 1 from public.tasks t where t.id = task_id and public.can_view_project(t.project_id)));
create policy "authors edit comments" on public.comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors delete comments" on public.comments for delete using (author_id = auth.uid());
create policy "users manage own weekly items" on public.weekly_items for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "leaders view audit logs" on public.audit_logs for select using (public.is_workspace_leader(workspace_id));

-- Atomic workspace bootstrap: creates the workspace and its first leader safely.
create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  insert into public.workspaces (name, slug, created_by) values (workspace_name, workspace_slug, auth.uid()) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_id, auth.uid(), 'leader');
  return new_id;
end;
$$;
grant execute on function public.create_workspace(text, text) to authenticated;

-- Audit task changes without exposing direct inserts to clients.
create or replace function public.audit_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_project uuid; target_workspace uuid; change_data jsonb;
begin
  target_project := coalesce(new.project_id, old.project_id);
  select workspace_id into target_workspace from public.projects where id = target_project;
  change_data := case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else coalesce(to_jsonb(new), to_jsonb(old)) end;
  insert into public.audit_logs (workspace_id, actor_id, entity_type, entity_id, action, changes)
  values (target_workspace, auth.uid(), 'task', coalesce(new.id, old.id), lower(tg_op), change_data);
  return coalesce(new, old);
end;
$$;
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function public.audit_task_change();

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.comments;
