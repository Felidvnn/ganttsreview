"use client";

import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, Clock3, History, Plus, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { sortTasksByDate, taskDepth } from "@/lib/task-order";
import { calculateTaskDelayMetrics } from "@/lib/task-delay-metrics";
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

  useEffect(() => {
    load();
    const refresh = () => { void load(); };
    window.addEventListener("orbit:refresh-data", refresh);
    return () => window.removeEventListener("orbit:refresh-data", refresh);
  }, [projectId, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const delayMetrics = useMemo(() => calculateTaskDelayMetrics(tasks), [tasks]);
  const delayedTasks = useMemo(() => sortTasksByDate(tasks.filter((task) => (delayMetrics.currentByTask.get(task.id) ?? 0) > 0 || records.some((record) => record.task_id === task.id))), [delayMetrics, records, tasks]);

  const openRecordModal = (task?: Task) => {
    const target = task ?? delayedTasks[0] ?? tasks[0];
    setSelectedTask(target?.id || ""); setDays(target ? Math.max(1, delayMetrics.currentByTask.get(target.id) ?? 0) : 1);
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
    <div className="delay-metrics"><article><span><AlertTriangle /></span><div><small>DESFASE MÁXIMO ACTUAL</small><b>{delayMetrics.maximumDelayDays} <em>días</em></b><p>Mayor atraso vigente, sin sumar niveles jerárquicos.</p></div></article><article><span><CalendarClock /></span><div><small>TAREAS AFECTADAS</small><b>{delayMetrics.affectedTaskCount}</b><p>Actividades representativas, excluyendo padres duplicados.</p></div></article><article><span><Clock3 /></span><div><small>DÍAS-TAREA COMPROMETIDOS</small><b>{delayMetrics.taskDays} <em>días</em></b><p>Volumen operativo atrasado en tareas representativas.</p></div></article><article><span><History /></span><div><small>EVENTOS DOCUMENTADOS</small><b>{records.length}</b><p>Motivos registrados como trazabilidad, sin sumarlos.</p></div></article></div>
    {error && <p className="form-error delay-error">{error}</p>}
    <div className="delay-task-list">
      <div className="delay-list-head"><span>Tarea</span><span>Fecha límite</span><span>Fecha real</span><span>Atraso actual</span><span>Documentado</span><span /></div>
      {delayedTasks.map((task) => {
        const taskRecords = records.filter((record) => record.task_id === task.id);
        const isOpen = expanded.includes(task.id);
        return <article className="delay-task" key={task.id}>
          <div className="delay-task-row"><button className="delay-task-title" onClick={() => onOpenTask(task)}><i style={{ marginLeft: `${taskDepth(task, tasks) * 13}px` }} /><span><b>{task.title}</b><small>{task.section} · {task.owners?.map((owner) => owner.name).join(", ") || task.owner.name}{delayMetrics.summaryTaskIds.has(task.id) ? " · Resumen jerárquico" : ""}</small></span></button><span>{shortDate(task.dueDate)}</span><span className={(delayMetrics.currentByTask.get(task.id) ?? 0) ? "late-date" : ""}>{shortDate(task.actualCompletionDate)}</span><strong className={(delayMetrics.currentByTask.get(task.id) ?? 0) ? "late-days" : ""}>{delayMetrics.currentByTask.get(task.id) ?? 0} d</strong><strong>{taskRecords.reduce((sum, record) => sum + record.delay_days, 0)} d</strong><div>{canEdit && <button className="icon-button" title="Agregar motivo" onClick={() => openRecordModal(task)}><Plus size={14} /></button>}<button className="icon-button" onClick={() => setExpanded((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-label="Ver historial">{isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div></div>
          {isOpen && <div className="delay-history">{taskRecords.map((record) => <div key={record.id}><span><History size={14} /></span><div><b>{record.reason}</b><p>{record.notes || "Sin notas adicionales."}</p><small>{shortDate(record.occurred_on)} · {record.delay_days} días registrados</small></div>{canEdit && <button onClick={() => remove(record.id)} title="Eliminar registro"><Trash2 size={14} /></button>}</div>)}{!taskRecords.length && <p className="delay-empty-history">La fecha indica atraso, pero todavía no se ha documentado un motivo.</p>}</div>}
        </article>;
      })}
      {!loading && !delayedTasks.length && <div className="delay-empty"><span><Clock3 /></span><b>El proyecto está al día</b><p>Aquí aparecerán las tareas vencidas o con movimientos de plazo registrados.</p></div>}
      {loading && <div className="delay-empty"><b>Cargando atrasos…</b></div>}
    </div>

    {modalOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Registrar atraso"><button className="modal-backdrop" onClick={() => setModalOpen(false)} /><section className="modal-card delay-modal"><div className="modal-head"><div><span className="eyebrow">NUEVO REGISTRO</span><h2>Documentar un atraso</h2><p>Este evento aporta trazabilidad; no se suma automáticamente al desfase real del proyecto.</p></div><button className="icon-button" onClick={() => setModalOpen(false)}><X size={18} /></button></div><form onSubmit={save}><label className="field-label">Tarea<select value={selectedTask} onChange={(event) => { setSelectedTask(event.target.value); const task = tasks.find((item) => item.id === event.target.value); if (task) setDays(Math.max(1, delayMetrics.currentByTask.get(task.id) ?? 0)); }} required>{sortTasksByDate(tasks).map((task) => <option value={task.id} key={task.id}>{"↳ ".repeat(taskDepth(task, tasks))}{task.title}</option>)}</select></label><label className="field-label">Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Entrega tardía de planos del proveedor" maxLength={240} required /></label><div className="form-grid"><label className="field-label">Días atribuibles<input type="number" min="1" max="3650" value={days} onChange={(event) => setDays(Number(event.target.value))} required /></label><label className="field-label">Fecha del registro<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label></div><label className="field-label">Detalle<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Acuerdos, responsables, impacto o acciones de recuperación…" /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar registro"}</button></div></form></section></div>}
  </section>;
}
