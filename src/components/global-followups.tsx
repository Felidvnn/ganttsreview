"use client";

import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarClock, Check, ChevronRight, ClipboardCheck, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WeeklyItemData } from "@/lib/supabase/week-data";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export type TrackingProject = { id: string; name: string; code: string; color: string; canEdit: boolean };
type FollowupStatus = "open" | "done" | "blocked";
type Followup = { id: string; project_id: string; task_id: string | null; title: string; notes: string; owner_label: string | null; due_date: string | null; status: FollowupStatus; is_blocker: boolean; completed_at: string | null };
type ProjectTask = { id: string; project_id: string; title: string };
const emptyDraft = { projectId: "", title: "", notes: "", owner: "", dueDate: "", status: "open" as FollowupStatus, isBlocker: false, taskId: "" };

export function GlobalFollowups({ projects, weeklyItems, weekStart }: { projects: TrackingProject[]; weeklyItems: WeeklyItemData[]; weekStart: string }) {
  const [items, setItems] = useState<Followup[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft, projectId: projects.find((project) => project.canEdit)?.id || projects[0]?.id || "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = format(new Date(), "yyyy-MM-dd");

  const load = async () => {
    if (!hasSupabaseConfig) { setLoading(false); return; }
    setLoading(true);
    const supabase = createClient()!;
    const [followupsResult, tasksResult] = await Promise.all([
      supabase.from("project_followups").select("id,project_id,task_id,title,notes,owner_label,due_date,status,is_blocker,completed_at").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("tasks").select("id,project_id,title").order("title").limit(1000),
    ]);
    if (followupsResult.error) setError(followupsResult.error.code === "42P01" || followupsResult.error.code === "PGRST205" ? "Falta aplicar la migración 202607140007_subtasks_followups.sql." : followupsResult.error.message);
    else setItems((followupsResult.data || []) as Followup[]);
    setTasks((tasksResult.data || []) as ProjectTask[]); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openItems = useMemo(() => items.filter((item) => item.status !== "done").sort((a, b) => Number(b.is_blocker) - Number(a.is_blocker) || (a.due_date || "9999").localeCompare(b.due_date || "9999")), [items]);
  const grouped = projects.map((project) => ({ project, items: openItems.filter((item) => item.project_id === project.id) })).filter((group) => group.items.length);
  const selectedProject = projects.find((project) => project.id === draft.projectId);
  const openCreate = () => { const projectId = projects.find((project) => project.canEdit)?.id || ""; setDraft({ ...emptyDraft, projectId }); setEditingId(null); setError(""); setEditorOpen(true); };
  const openEdit = (item: Followup) => { setEditingId(item.id); setDraft({ projectId: item.project_id, title: item.title, notes: item.notes, owner: item.owner_label || "", dueDate: item.due_date || "", status: item.status, isBlocker: item.is_blocker, taskId: item.task_id || "" }); setEditorOpen(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    const payload = { project_id: draft.projectId, task_id: draft.taskId || null, title: draft.title.trim(), notes: draft.notes.trim(), owner_label: draft.owner.trim() || null, due_date: draft.dueDate || null, status: draft.status, is_blocker: draft.isBlocker, completed_at: draft.status === "done" ? new Date().toISOString() : null };
    const supabase = createClient()!;
    if (editingId) {
      const { data, error: saveError } = await supabase.from("project_followups").update(payload).eq("id", editingId).select().single();
      if (saveError) { setError(saveError.message); setBusy(false); return; }
      setItems((current) => current.map((item) => item.id === editingId ? data as Followup : item));
    } else {
      const { data: authData } = await supabase.auth.getUser();
      const { data, error: saveError } = await supabase.from("project_followups").insert({ ...payload, created_by: authData.user?.id }).select().single();
      if (saveError) { setError(saveError.message); setBusy(false); return; }
      setItems((current) => [data as Followup, ...current]);
    }
    setBusy(false); setEditorOpen(false);
  };
  const toggle = async (item: Followup) => {
    const next = { ...item, status: item.status === "done" ? "open" as const : "done" as const, completed_at: item.status === "done" ? null : new Date().toISOString() };
    setItems((current) => current.map((entry) => entry.id === item.id ? next : entry));
    const { error: updateError } = await createClient()!.from("project_followups").update({ status: next.status, completed_at: next.completed_at }).eq("id", item.id);
    if (updateError) { setItems((current) => current.map((entry) => entry.id === item.id ? item : entry)); setError(updateError.message); }
  };
  const remove = async (item: Followup) => { if (!window.confirm(`¿Eliminar “${item.title}”?`)) return; const { error: removeError } = await createClient()!.from("project_followups").delete().eq("id", item.id); if (removeError) { setError(removeError.message); return; } setItems((current) => current.filter((entry) => entry.id !== item.id)); };
  const calendarDays = Array.from({ length: 7 }, (_, index) => addDays(parseISO(weekStart), index));

  return <div className="global-followups">
    <section className="tracking-overview panel"><div><span className="eyebrow">CONTROL TRANSVERSAL</span><h3>Pendientes y compromisos</h3><p>Lo que debes perseguir fuera de la Gantt, organizado por proyecto.</p></div><div className="tracking-metrics"><span><b>{openItems.length}</b> abiertos</span><span className="danger"><b>{openItems.filter((item) => item.due_date && item.due_date < today).length}</b> atrasados</span><span><b>{openItems.filter((item) => item.is_blocker).length}</b> bloqueos</span></div>{projects.some((project) => project.canEdit) && <button className="button primary" onClick={openCreate}><Plus size={15} /> Nuevo pendiente</button>}</section>
    {error && <p className="form-error tracking-error">{error}</p>}
    <section className="tracking-projects">{grouped.map(({ project, items: projectItems }) => <article className="tracking-project panel" key={project.id}><header style={{ borderColor: project.color }}><div><small>{project.code}</small><h3>{project.name}</h3></div><span>{projectItems.length} abiertos</span></header><div>{projectItems.map((item) => <button className={`tracking-item ${item.is_blocker ? "blocker" : ""}`} key={item.id} onClick={() => openEdit(item)}><span className="tracking-check" onClick={(event) => { event.stopPropagation(); if (project.canEdit) toggle(item); }}>{item.status === "done" && <Check size={12} />}</span><div><b>{item.title}</b><p>{item.notes || "Sin detalle adicional"}</p><footer>{item.owner_label && <span>{item.owner_label}</span>}{item.due_date && <span className={item.due_date < today ? "late" : ""}><CalendarClock size={11} />{item.due_date}</span>}{item.task_id && <span><Link2 size={11} />{tasks.find((task) => task.id === item.task_id)?.title || "Tarea asociada"}</span>}{item.is_blocker && <em><AlertTriangle size={11} /> Bloqueo</em>}</footer></div><ChevronRight size={16} /></button>)}</div></article>)}{!grouped.length && !loading && <div className="tracking-empty panel"><ClipboardCheck size={25} /><b>No hay pendientes de proyecto</b><span>Cuando registres compromisos aparecerán agrupados aquí.</span></div>}</section>
    <section className="tracking-calendar panel"><header><div><span className="eyebrow">CALENDARIO SEMANAL</span><h3>Plazos, tareas y compromisos</h3></div><div><span><i className="personal" /> Personal</span><span><i className="project" /> Tarea/proyecto</span><span><i className="blocker" /> Bloqueo</span></div></header><div className="tracking-calendar-grid">{calendarDays.map((day) => { const key = format(day, "yyyy-MM-dd"); const scheduled = weeklyItems.filter((item) => item.source !== "followup" && item.dueDate === key); const commitments = items.filter((item) => item.due_date === key && item.status !== "done"); return <article className={key === today ? "today" : ""} key={key}><header><span>{format(day, "EEE", { locale: es })}</span><b>{format(day, "d")}</b></header>{scheduled.map((item) => <div className={`calendar-event ${item.source === "task" ? "project" : "personal"}`} style={{ borderColor: item.source === "task" ? projects.find((project) => project.id === item.projectId)?.color : undefined }} key={item.id}>{item.title}</div>)}{commitments.map((item) => <div className={`calendar-event ${item.is_blocker ? "blocker" : "project"}`} style={{ borderColor: item.is_blocker ? undefined : projects.find((project) => project.id === item.project_id)?.color }} key={item.id}>{item.title}</div>)}</article>; })}</div></section>
    {editorOpen && <div className="modal-layer"><button className="modal-backdrop" onClick={() => setEditorOpen(false)} /><form className="modal-card followup-editor" onSubmit={save}><div className="modal-head"><div><span className="eyebrow">PENDIENTE</span><h2>{editingId ? "Detalle del pendiente" : "Nuevo pendiente"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)}><X size={18} /></button></div><label className="field-label">Proyecto<select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value, taskId: "" })} disabled={Boolean(editingId)}>{projects.filter((project) => project.canEdit || project.id === draft.projectId).map((project) => <option value={project.id} key={project.id}>{project.code} · {project.name}</option>)}</select></label><label className="field-label">Pendiente o compromiso<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required autoFocus /></label><label className="field-label">Detalle<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={5} placeholder="Contexto, acuerdo, próximo paso o evidencia…" /></label><div className="form-grid"><label className="field-label">Responsable<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label><label className="field-label">Plazo<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label></div><div className="form-grid"><label className="field-label">Tarea asociada<select value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}><option value="">Ninguna</option>{tasks.filter((task) => task.project_id === draft.projectId).map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label><label className="field-label">Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as FollowupStatus })}><option value="open">Abierto</option><option value="blocked">En espera</option><option value="done">Completado</option></select></label></div><label className="rollup-choice"><span><b>Es un bloqueo</b><small>Impide el avance de una tarea o del proyecto.</small></span><input type="checkbox" checked={draft.isBlocker} onChange={(event) => setDraft({ ...draft, isBlocker: event.target.checked })} /><i /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions">{editingId && selectedProject?.canEdit && <button type="button" className="button danger-outline" onClick={() => { const item = items.find((entry) => entry.id === editingId); if (item) remove(item); }}><Trash2 size={14} /> Eliminar</button>}<span /><button type="button" className="button secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{selectedProject?.canEdit && <button className="button primary" disabled={busy}>{busy ? "Guardando…" : <><Pencil size={14} /> Guardar</>}</button>}</div></form></div>}
  </div>;
}
