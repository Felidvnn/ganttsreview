-- Orbit: titled project notes with task mentions.
-- Run this after 202607200021_project_section_management.sql.

alter table public.project_notes
  add column if not exists title text not null default 'Nota del proyecto'
    check (char_length(trim(title)) between 1 and 160),
  add column if not exists mentioned_task_ids uuid[] not null default '{}'::uuid[];

create index if not exists project_notes_mentions_idx
  on public.project_notes using gin(mentioned_task_ids);

create or replace function public.validate_project_note_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare mentioned_task uuid;
begin
  new.title := trim(new.title);

  if new.linked_followup_id is not null and not exists (
    select 1 from public.project_followups followup
    where followup.id = new.linked_followup_id and followup.project_id = new.project_id
  ) then raise exception 'El pendiente vinculado no pertenece al proyecto'; end if;

  if new.linked_delay_id is not null and not exists (
    select 1 from public.task_delay_records delay
    join public.tasks task on task.id = delay.task_id
    where delay.id = new.linked_delay_id and task.project_id = new.project_id
  ) then raise exception 'El atraso vinculado no pertenece al proyecto'; end if;

  foreach mentioned_task in array coalesce(new.mentioned_task_ids, '{}'::uuid[]) loop
    if not exists (
      select 1 from public.tasks task
      where task.id = mentioned_task and task.project_id = new.project_id
    ) then raise exception 'Una tarea mencionada no pertenece al proyecto'; end if;
  end loop;

  new.mentioned_task_ids := array(
    select distinct value
    from unnest(coalesce(new.mentioned_task_ids, '{}'::uuid[])) value
  );
  return new;
end;
$$;

notify pgrst, 'reload schema';
