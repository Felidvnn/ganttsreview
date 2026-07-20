"use client";

import { ArrowDown, ArrowUp, CalendarDays, Check, GripVertical, Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { sortTasksByDate, sortTasksManual, taskDepth, taskDisplaySection } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export function ProjectPlanOrder({ projectId, sections, tasks, orderMode, open, onClose, onSaved }: {
  projectId: string;
  sections: string[];
  tasks: Task[];
  orderMode: "date" | "manual";
  open: boolean;
  onClose: () => void;
  onSaved: (sections: string[], tasks: Task[], mode: "date" | "manual") => void;
}) {
  const [sectionDraft, setSectionDraft] = useState(sections);
  const [taskDraft, setTaskDraft] = useState(tasks.map((task) => task.id));
  const [taskChanged, setTaskChanged] = useState(false);
  const [editingSection, setEditingSection] = useState("");
  const [sectionNameDraft, setSectionNameDraft] = useState("");
  const [deletingSection, setDeletingSection] = useState("");
  const [replacementSection, setReplacementSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSectionDraft(sections); setTaskDraft(tasks.map((task) => task.id)); setTaskChanged(false); setEditingSection(""); setDeletingSection(""); setError("");
  }, [open, sections, tasks]);

  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const preview = useMemo(() => sortTasksManual(tasks.map((task) => ({ ...task, sortOrder: taskDraft.indexOf(task.id) * 10 }))), [taskDraft, tasks]);
  if (!open) return null;

  const moveSection = (index: number, direction: -1 | 1) => setSectionDraft((current) => {
    const target = index + direction; if (target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  });

  const moveTask = (taskId: string, direction: -1 | 1) => {
    const task = taskMap.get(taskId); if (!task) return;
    const siblings = preview.filter((item) => item.parentId === task.parentId && taskDisplaySection(item, tasks) === taskDisplaySection(task, tasks));
    const index = siblings.findIndex((item) => item.id === taskId); const sibling = siblings[index + direction]; if (!sibling) return;
    setTaskDraft((current) => {
      const next = [...current]; const left = next.indexOf(taskId); const right = next.indexOf(sibling.id);
      [next[left], next[right]] = [next[right], next[left]]; return next;
    });
    setTaskChanged(true);
  };

  const persist = async (nextTasks: string[], mode: "date" | "manual") => {
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: saveError } = await createClient()!.rpc("save_project_plan_order", {
        target_project: projectId, ordered_sections: sectionDraft, ordered_tasks: nextTasks, next_mode: mode,
      });
      if (saveError) { setError(saveError.code === "PGRST202" ? "Falta aplicar la migración 202607200019_project_notes_ordering_bulk_copy.sql." : saveError.message); setBusy(false); return; }
    }
    const ordered = tasks.map((task) => ({ ...task, sortOrder: nextTasks.indexOf(task.id) * 10 }));
    onSaved(sectionDraft, mode === "date" ? sortTasksByDate(ordered) : sortTasksManual(ordered), mode);
    setBusy(false); onClose();
  };

  const dateOrder = () => persist(sortTasksByDate(tasks).map((task) => task.id), "date");

  const renameSection = async (currentName: string) => {
    const clean = sectionNameDraft.trim(); if (!clean || clean === currentName) { setEditingSection(""); return; }
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: renameError } = await createClient()!.rpc("rename_project_section", { target_project: projectId, current_name: currentName, next_name: clean });
      if (renameError) { setError(renameError.code === "PGRST202" ? "Falta aplicar la migración 202607200021_project_section_management.sql." : renameError.message); setBusy(false); return; }
    }
    const nextSections = sectionDraft.map((name) => name === currentName ? clean : name);
    const nextTasks = tasks.map((task) => task.section === currentName ? { ...task, section: clean } : task);
    setSectionDraft(nextSections); setEditingSection(""); setBusy(false);
    onSaved(nextSections, orderMode === "manual" ? sortTasksManual(nextTasks) : sortTasksByDate(nextTasks), orderMode);
  };

  const beginDeleteSection = (name: string) => {
    setDeletingSection(name); setReplacementSection(sectionDraft.find((section) => section !== name) || ""); setEditingSection(""); setError("");
  };

  const deleteSection = async (name: string) => {
    const affected = tasks.filter((task) => taskDisplaySection(task, tasks) === name).length;
    if (affected > 0 && !replacementSection) return;
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: deleteError } = await createClient()!.rpc("delete_project_section", { target_project: projectId, section_name: name, replacement_name: affected ? replacementSection : null });
      if (deleteError) { setError(deleteError.code === "PGRST202" ? "Falta aplicar la migración 202607200021_project_section_management.sql." : deleteError.message); setBusy(false); return; }
    }
    const nextSections = sectionDraft.filter((section) => section !== name);
    const nextTasks = tasks.map((task) => taskDisplaySection(task, tasks) === name ? { ...task, section: replacementSection || task.section } : task);
    setSectionDraft(nextSections); setDeletingSection(""); setBusy(false);
    onSaved(nextSections, orderMode === "manual" ? sortTasksManual(nextTasks) : sortTasksByDate(nextTasks), orderMode);
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Ordenar planificación">
    <button className="modal-backdrop" onClick={onClose} />
    <section className="modal-card plan-order-modal">
      <header className="modal-head"><div><span className="eyebrow">ORDEN DE LA PLANIFICACIÓN</span><h2>Secciones y tareas</h2><p>Las secciones conservan siempre tu orden. Dentro de cada nivel puedes ordenar manualmente o volver al orden cronológico.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
      <div className="plan-order-actions"><button type="button" className="button secondary" onClick={dateOrder} disabled={busy}><CalendarDays size={15} /> Ordenar tareas por fecha</button><span>{orderMode === "manual" ? "Orden manual activo" : "Orden por fecha activo"}</span></div>
      <div className="plan-order-sections">{sectionDraft.map((section, sectionIndex) => <article key={section}>
        <header><GripVertical size={15} />{editingSection === section ? <input autoFocus value={sectionNameDraft} maxLength={100} onChange={(event) => setSectionNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") renameSection(section); if (event.key === "Escape") setEditingSection(""); }} /> : <b>{section}</b>}<span>{preview.filter((task) => taskDisplaySection(task, tasks) === section).length}</span><button type="button" onClick={() => moveSection(sectionIndex, -1)} disabled={sectionIndex === 0 || busy} title="Subir sección"><ArrowUp size={14} /></button><button type="button" onClick={() => moveSection(sectionIndex, 1)} disabled={sectionIndex === sectionDraft.length - 1 || busy} title="Bajar sección"><ArrowDown size={14} /></button>{editingSection === section ? <><button type="button" onClick={() => renameSection(section)} disabled={busy || !sectionNameDraft.trim()} title="Guardar nombre"><Check size={14} /></button><button type="button" onClick={() => setEditingSection("")} disabled={busy} title="Cancelar"><X size={14} /></button></> : <><button type="button" onClick={() => { setEditingSection(section); setSectionNameDraft(section); setDeletingSection(""); }} disabled={busy} title="Cambiar nombre"><Pencil size={13} /></button><button type="button" onClick={() => beginDeleteSection(section)} disabled={busy || sectionDraft.length <= 1} title={sectionDraft.length <= 1 ? "El proyecto debe conservar una sección" : "Eliminar sección"}><Trash2 size={13} /></button></>}</header>
        {deletingSection === section && <div className="section-delete-panel"><div><b>Eliminar “{section}”</b><span>{preview.filter((task) => taskDisplaySection(task, tasks) === section).length ? "Sus tareas se moverán; no se eliminará ninguna." : "Esta sección está vacía."}</span></div>{preview.some((task) => taskDisplaySection(task, tasks) === section) && <label>Mover a<select value={replacementSection} onChange={(event) => setReplacementSection(event.target.value)}>{sectionDraft.filter((name) => name !== section).map((name) => <option value={name} key={name}>{name}</option>)}</select></label>}<button type="button" className="button secondary small" onClick={() => setDeletingSection("")}>Cancelar</button><button type="button" className="button danger-outline small" onClick={() => deleteSection(section)} disabled={busy}>{busy ? "Eliminando…" : "Eliminar sección"}</button></div>}
        <div>{preview.filter((task) => taskDisplaySection(task, tasks) === section).map((task) => {
          const siblings = preview.filter((item) => item.parentId === task.parentId && taskDisplaySection(item, tasks) === section);
          const position = siblings.findIndex((item) => item.id === task.id);
          return <div className={`plan-order-task depth-${taskDepth(task, tasks)}`} key={task.id}><span>{task.title}<small>{task.startDate || "Sin inicio"} · {task.dueDate || "Sin término"}</small></span><button type="button" onClick={() => moveTask(task.id, -1)} disabled={position === 0}><ArrowUp size={13} /></button><button type="button" onClick={() => moveTask(task.id, 1)} disabled={position === siblings.length - 1}><ArrowDown size={13} /></button></div>;
        })}{!preview.some((task) => taskDisplaySection(task, tasks) === section) && <p>Sin tareas</p>}</div>
      </article>)}</div>
      {error && <p className="form-error">{error}</p>}
      <footer className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" onClick={() => persist(taskDraft, taskChanged ? "manual" : orderMode)} disabled={busy}><Save size={15} />{busy ? "Guardando…" : "Guardar orden"}</button></footer>
    </section>
  </div>;
}
