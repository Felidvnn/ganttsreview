"use client";

import { AlertTriangle, CalendarClock, Check, ClipboardCheck, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type FollowupStatus = "open" | "done" | "blocked";
type Followup = { id: string; project_id: string; task_id: string | null; title: string; notes: string; owner_label: string | null; due_date: string | null; status: FollowupStatus; is_blocker: boolean; created_by: string; completed_at: string | null; created_at: string };

const emptyDraft = { title: "", notes: "", owner: "", dueDate: "", status: "open" as FollowupStatus, isBlocker: false, taskId: "" };

export function ProjectFollowups({ projectId, tasks, canEdit }: { projectId: string; tasks: Task[]; canEdit: boolean }) {
  const [items, setItems] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const openItems = useMemo(() => items.filter((item) => item.status !== "done").sort((left, right) => Number(right.is_blocker) - Number(left.is_blocker) || (left.due_date || "9999").localeCompare(right.due_date || "9999")), [items]);
  const doneItems = items.filter((item) => item.status === "done");
  const overdue = openItems.filter((item) => item.due_date && item.due_date < today).length;

  const load = async () => {
    if (!hasSupabaseConfig) { setLoading(false); return; }
    setLoading(true); setError("");
    const { data, error: loadError } = await createClient()!.from("project_followups").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
    if (loadError) setError(loadError.code === "42P01" || loadError.code === "PGRST205" ? "Falta aplicar la migración 202607140007_subtasks_followups.sql." : loadError.message);
    else setItems((data || []) as Followup[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setEditingId(null); setDraft(emptyDraft); setError(""); setEditorOpen(true); };
  const openEdit = (item: Followup) => { setEditingId(item.id); setDraft({ title: item.title, notes: item.notes, owner: item.owner_label || "", dueDate: item.due_date || "", status: item.status, isBlocker: item.is_blocker, taskId: item.task_id || "" }); setError(""); setEditorOpen(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canEdit) return;
    setBusy(true); setError("");
    const payload = { project_id: projectId, task_id: draft.taskId || null, title: draft.title.trim(), notes: draft.notes.trim(), owner_label: draft.owner.trim() || null, due_date: draft.dueDate || null, status: draft.status, is_blocker: draft.isBlocker, completed_at: draft.status === "done" ? new Date().toISOString() : null };
    if (hasSupabaseConfig) {
      const supabase = createClient()!;
      if (editingId) {
        const { data, error: saveError } = await supabase.from("project_followups").update(payload).eq("id", editingId).select("*").single();
        if (saveError) { setError(saveError.message); setBusy(false); return; }
        setItems((current) => current.map((item) => item.id === editingId ? data as Followup : item));
      } else {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) { setError("Debes iniciar sesión nuevamente."); setBusy(false); return; }
        const { data, error: saveError } = await supabase.from("project_followups").insert({ ...payload, created_by: authData.user.id }).select("*").single();
        if (saveError) { setError(saveError.message); setBusy(false); return; }
        setItems((current) => [data as Followup, ...current]);
      }
    }
    setBusy(false); setEditorOpen(false);
  };
  const toggleDone = async (item: Followup) => {
    if (!canEdit) return; const done = item.status !== "done";
    const next = { ...item, status: done ? "done" as const : "open" as const, completed_at: done ? new Date().toISOString() : null };
    setItems((current) => current.map((currentItem) => currentItem.id === item.id ? next : currentItem));
    if (hasSupabaseConfig) { const { error: updateError } = await createClient()!.from("project_followups").update({ status: next.status, completed_at: next.completed_at }).eq("id", item.id); if (updateError) { setItems((current) => current.map((currentItem) => currentItem.id === item.id ? item : currentItem)); setError(updateError.message); } }
  };
  const remove = async (item: Followup) => {
    if (!canEdit || !window.confirm(`¿Eliminar “${item.title}”?`)) return;
    if (hasSupabaseConfig) { const { error: removeError } = await createClient()!.from("project_followups").delete().eq("id", item.id); if (removeError) { setError(removeError.message); return; } }
    setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
  };
  const taskName = (taskId: string | null) => tasks.find((task) => task.id === taskId)?.title;

  return <section className="followup-view">
    <header className="followup-hero"><div><span className="eyebrow">CONTROL OPERATIVO</span><h3>Seguimiento del proyecto</h3><p>Compromisos, pendientes y recordatorios que no necesitan formar parte de la Gantt.</p></div>{canEdit && <button className="button primary" onClick={openCreate}><Plus size={16} /> Nuevo seguimiento</button>}</header>
    <div className="followup-metrics"><article><span>ABIERTOS</span><b>{openItems.length}</b></article><article className={overdue ? "danger" : ""}><span>ATRASADOS</span><b>{overdue}</b></article><article><span>BLOQUEOS</span><b>{openItems.filter((item) => item.is_blocker).length}</b></article><article><span>COMPLETADOS</span><b>{doneItems.length}</b></article></div>
    {error && <p className="form-error followup-error">{error}</p>}
    <div className="followup-list">{openItems.map((item) => <article className={`followup-card ${item.is_blocker ? "blocker" : ""} ${item.due_date && item.due_date < today ? "overdue" : ""}`} key={item.id}><button className={`followup-check ${item.status === "done" ? "done" : ""}`} onClick={() => toggleDone(item)} disabled={!canEdit}>{item.status === "done" && <Check size={13} />}</button><div className="followup-copy"><div><b>{item.title}</b>{item.is_blocker && <span className="blocker-chip"><AlertTriangle size={11} /> Bloqueo</span>}</div>{item.notes && <p>{item.notes}</p>}<footer>{item.owner_label && <span>{item.owner_label}</span>}{item.due_date && <span className={item.due_date < today ? "late" : ""}><CalendarClock size={12} /> {item.due_date}</span>}{item.task_id && <span><Link2 size={12} /> {taskName(item.task_id) || "Tarea asociada"}</span>}</footer></div>{canEdit && <div className="followup-actions"><button onClick={() => openEdit(item)}><Pencil size={14} /></button><button onClick={() => remove(item)}><Trash2 size={14} /></button></div>}</article>)}{!openItems.length && !loading && <div className="followup-empty"><ClipboardCheck size={24} /><b>Todo bajo control</b><span>No tienes compromisos abiertos en este proyecto.</span>{canEdit && <button className="button secondary" onClick={openCreate}><Plus size={14} /> Agregar seguimiento</button>}</div>}</div>
    {doneItems.length > 0 && <details className="followup-completed"><summary>Completados <span>{doneItems.length}</span></summary>{doneItems.map((item) => <article key={item.id}><button className="followup-check done" onClick={() => toggleDone(item)} disabled={!canEdit}><Check size={13} /></button><span>{item.title}</span>{canEdit && <button onClick={() => remove(item)}><Trash2 size={13} /></button>}</article>)}</details>}
    {editorOpen && <div className="modal-layer followup-editor-layer"><button className="modal-backdrop" onClick={() => setEditorOpen(false)} /><form className="modal-card followup-editor" onSubmit={save}><div className="modal-head"><div><span className="eyebrow">SEGUIMIENTO</span><h2>{editingId ? "Editar compromiso" : "Nuevo compromiso"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)}><X size={18} /></button></div><label className="field-label">Pendiente o compromiso<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required autoFocus /></label><label className="field-label">Notas<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={4} placeholder="Contexto, acuerdos o próximo paso…" /></label><div className="form-grid"><label className="field-label">Responsable<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Persona, proveedor o empresa" /></label><label className="field-label">Plazo<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label></div><div className="form-grid"><label className="field-label">Tarea asociada<select value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}><option value="">Ninguna</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label><label className="field-label">Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as FollowupStatus })}><option value="open">Abierto</option><option value="blocked">En espera</option><option value="done">Completado</option></select></label></div><label className="rollup-choice followup-blocker-choice"><span><b>Marcar como bloqueo</b><small>Destácalo como un impedimento para el proyecto o la tarea asociada.</small></span><input type="checkbox" checked={draft.isBlocker} onChange={(event) => setDraft({ ...draft, isBlocker: event.target.checked })} /><i /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditorOpen(false)}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div></form></div>}
  </section>;
}
