"use client";

import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, Clock3, History, Plus, Trash2, X } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { sortTasksByDate, taskDepth } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type DelayRecord = {
  id: string;
  task_id: string;
  reason: string;
  delay_days: number;
  occurred_on: string;
  notes: string;
  created_at: string;
};

function currentDelay(task: Task) {
  if (!task.dueDate) return 0;
  const due = new Date(`${task.dueDate}T12:00:00`);
  const reference = task.actualCompletionDate
    ? new Date(`${task.actualCompletionDate}T12:00:00`)
    : task.status === "done" ? due : new Date();
  return Math.max(0, differenceInCalendarDays(reference, due));
}

function shortDate(value?: string) {
  return value ? format(new Date(`${value}T12:00:00`), "dd MMM yyyy", { locale: es }) : "Sin fecha";
}

export function ProjectDelays({ projectId, tasks, canEdit, onOpenTask }: { projectId: string; tasks: Task[]; canEdit: boolean; onOpenTask: (task: Task) => void }) {
  const [records, setRecords] = useState<DelayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(1);
  const [occurredOn, setOccurredOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!hasSupabaseConfig) { setLoading(false); return; }
    setLoading(true); setError("");
    const taskIds = tasks.map((task) => task.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!taskIds.length) { setRecords([]); setLoading(false); return; }
    const { data, error: loadError } = await createClient()!.from("task_delay_records").select("id,task_id,reason,delay_days,occurred_on,notes,created_at").in("task_id", taskIds).order("occurred_on", { ascending: false });
    if (loadError) setError(loadError.code === "42P01" || loadError.code === "PGRST205" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : loadError.message);
    else setRecords((data || []) as DelayRecord[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const delayedTasks = useMemo(() => sortTasksByDate(tasks.filter((task) => currentDelay(task) > 0 || records.some((record) => record.task_id === task.id))), [records, tasks]);
  const currentDays = tasks.reduce((sum, task) => sum + currentDelay(task), 0);
  const historicDays = records.reduce((sum, record) => sum + record.delay_days, 0);
  const finishedLate = tasks.filter((task) => task.actualCompletionDate && task.dueDate && task.actualCompletionDate > task.dueDate).length;

  const openRecordModal = (task?: Task) => {
    const target = task ?? delayedTasks[0] ?? tasks[0];
    setSelectedTask(target?.id || ""); setDays(target ? Math.max(1, currentDelay(target)) : 1);
    setReason(""); setNotes(""); setOccurredOn(format(new Date(), "yyyy-MM-dd")); setError(""); setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedTask || !reason.trim()) return;
    setSaving(true); setError("");
    if (hasSupabaseConfig) {
      const { error: saveError } = await createClient()!.rpc("save_task_delay", { target_task: selectedTask, delay_reason: reason, target_delay_days: days, target_occurred_on: occurredOn, delay_notes: notes });
      if (saveError) { setError(saveError.code === "PGRST202" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : saveError.message); setSaving(false); return; }
      await load();
    } else {
      setRecords((current) => [{ id: `demo-${Date.now()}`, task_id: selectedTask, reason, delay_days: days, occurred_on: occurredOn, notes, created_at: new Date().toISOString() }, ...current]);
    }
    setSaving(false); setModalOpen(false);
  };

  const remove = async (id: string) => {
    if (!window.confirm("¿Quitar este registro de atraso? La tarea no será eliminada.")) return;
    if (hasSupabaseConfig) {
      const { error: removeError } = await createClient()!.rpc("delete_task_delay", { target_delay: id });
      if (removeError) { setError(removeError.message); return; }
    }
    setRecords((current) => current.filter((record) => record.id !== id));
  };

  return <section className="project-delays-view">
    <header className="delays-intro"><div><span className="eyebrow">CONTROL DE PLAZOS</span><h2>Atrasos del proyecto</h2><p>Compara la fecha límite con el cierre real y conserva el motivo de cada desplazamiento.</p></div>{canEdit && <button className="button primary small" onClick={() => openRecordModal()} disabled={!tasks.length}><Plus size={15} /> Registrar atraso</button>}</header>
    <div className="delay-metrics"><article><span><AlertTriangle /></span><div><small>ATRASO ACTUAL</small><b>{currentDays} <em>días</em></b><p>Suma de tareas aún fuera de plazo.</p></div></article><article><span><History /></span><div><small>ATRASO ACUMULADO</small><b>{historicDays} <em>días</em></b><p>Movimientos explicados y registrados.</p></div></article><article><span><CalendarClock /></span><div><small>CIERRES FUERA DE PLAZO</small><b>{finishedLate}</b><p>Tareas con fecha real posterior al límite.</p></div></article><article><span><Clock3 /></span><div><small>TAREAS CON HISTORIA</small><b>{new Set(records.map((record) => record.task_id)).size}</b><p>Actividades con causas documentadas.</p></div></article></div>
    {error && <p className="form-error delay-error">{error}</p>}
    <div className="delay-task-list">
      <div className="delay-list-head"><span>Tarea</span><span>Fecha límite</span><span>Fecha real</span><span>Atraso actual</span><span>Acumulado</span><span /></div>
      {delayedTasks.map((task) => {
        const taskRecords = records.filter((record) => record.task_id === task.id);
        const isOpen = expanded.includes(task.id);
        return <article className="delay-task" key={task.id}>
          <div className="delay-task-row"><button className="delay-task-title" onClick={() => onOpenTask(task)}><i style={{ marginLeft: `${taskDepth(task, tasks) * 13}px` }} /><span><b>{task.title}</b><small>{task.section} · {task.owners?.map((owner) => owner.name).join(", ") || task.owner.name}</small></span></button><span>{shortDate(task.dueDate)}</span><span className={currentDelay(task) ? "late-date" : ""}>{shortDate(task.actualCompletionDate)}</span><strong className={currentDelay(task) ? "late-days" : ""}>{currentDelay(task)} d</strong><strong>{taskRecords.reduce((sum, record) => sum + record.delay_days, 0)} d</strong><div>{canEdit && <button className="icon-button" title="Agregar motivo" onClick={() => openRecordModal(task)}><Plus size={14} /></button>}<button className="icon-button" onClick={() => setExpanded((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-label="Ver historial">{isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div></div>
          {isOpen && <div className="delay-history">{taskRecords.map((record) => <div key={record.id}><span><History size={14} /></span><div><b>{record.reason}</b><p>{record.notes || "Sin notas adicionales."}</p><small>{shortDate(record.occurred_on)} · {record.delay_days} días registrados</small></div>{canEdit && <button onClick={() => remove(record.id)} title="Eliminar registro"><Trash2 size={14} /></button>}</div>)}{!taskRecords.length && <p className="delay-empty-history">La fecha indica atraso, pero todavía no se ha documentado un motivo.</p>}</div>}
        </article>;
      })}
      {!loading && !delayedTasks.length && <div className="delay-empty"><span><Clock3 /></span><b>El proyecto está al día</b><p>Aquí aparecerán las tareas vencidas o con movimientos de plazo registrados.</p></div>}
      {loading && <div className="delay-empty"><b>Cargando atrasos…</b></div>}
    </div>

    {modalOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Registrar atraso"><button className="modal-backdrop" onClick={() => setModalOpen(false)} /><section className="modal-card delay-modal"><div className="modal-head"><div><span className="eyebrow">NUEVO REGISTRO</span><h2>Documentar un atraso</h2><p>Este registro se suma al historial; no modifica por sí solo las fechas de la Gantt.</p></div><button className="icon-button" onClick={() => setModalOpen(false)}><X size={18} /></button></div><form onSubmit={save}><label className="field-label">Tarea<select value={selectedTask} onChange={(event) => { setSelectedTask(event.target.value); const task = tasks.find((item) => item.id === event.target.value); if (task) setDays(Math.max(1, currentDelay(task))); }} required>{sortTasksByDate(tasks).map((task) => <option value={task.id} key={task.id}>{"↳ ".repeat(taskDepth(task, tasks))}{task.title}</option>)}</select></label><label className="field-label">Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Entrega tardía de planos del proveedor" maxLength={240} required /></label><div className="form-grid"><label className="field-label">Días atribuibles<input type="number" min="1" max="3650" value={days} onChange={(event) => setDays(Number(event.target.value))} required /></label><label className="field-label">Fecha del registro<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label></div><label className="field-label">Detalle<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Acuerdos, responsables, impacto o acciones de recuperación…" /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar registro"}</button></div></form></section></div>}
  </section>;
}
