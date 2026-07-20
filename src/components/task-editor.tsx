"use client";

import { AlertTriangle, Check, Link2, ListTree, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { Person, Task, TaskDependency, TaskStatus } from "@/lib/types";
import { defaultProjectStatuses, type ProjectTaskStatus } from "@/lib/task-statuses";
import { sortTasksByDate, taskDepth } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export type AssignableMember = { user_id: string; full_name: string; email: string };

type CandidateTask = { id: string; title: string; projectName: string; projectCode: string };
type DependencyRow = {
  id: string; dependency_type: TaskDependency["type"]; lag_days: number;
  predecessor?: { id: string; title: string; status: TaskStatus; projects?: { name: string; code: string } | { name: string; code: string }[] | null } | null;
};

const dependencyTypes = [
  { value: "finish_start", label: "Termina → comienza" },
  { value: "start_start", label: "Comienzan juntas" },
  { value: "finish_finish", label: "Terminan juntas" },
  { value: "start_finish", label: "Comienza → termina" },
] as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
}

function memberToPerson(member?: AssignableMember, manual?: string): Person {
  const name = member?.full_name || member?.email.split("@")[0] || manual || "Sin asignar";
  return { id: member?.user_id || (manual ? `manual-${name}` : "unassigned"), name, initials: initials(name), role: "Ingeniero", color: member ? "#476f8f" : "#7c8c86" };
}

export function TaskEditor({ task, allTasks, sections, members, canEdit, projectStatuses = defaultProjectStatuses, onClose, onUpdated, onCreated, onDeleted, onSelectTask }: {
  task: Task;
  allTasks: Task[];
  sections: string[];
  members: AssignableMember[];
  canEdit: boolean;
  projectStatuses?: ProjectTaskStatus[];
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onCreated: (task: Task) => void;
  onDeleted: (taskId: string) => void;
  onSelectTask: (task: Task) => void;
}) {
  const rememberedOwner = task.manualAssignee ? members.find((member) => member.user_id.startsWith("external:") && member.full_name.toLowerCase() === task.manualAssignee!.toLowerCase()) : undefined;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [section, setSection] = useState(task.section);
  const [startDate, setStartDate] = useState(task.startDate || "");
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [actualCompletionDate, setActualCompletionDate] = useState(task.actualCompletionDate || "");
  const [status, setStatus] = useState(task.status);
  const [progress, setProgress] = useState(task.progress);
  const [isMilestone, setIsMilestone] = useState(Boolean(task.isMilestone));
  const [color, setColor] = useState(task.color || "#2f7669");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(() => [
    ...(task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : [])),
    ...(task.directoryAssigneeIds ?? (rememberedOwner ? [rememberedOwner.user_id.replace("external:", "")] : [])).map((id) => `external:${id}`),
  ]);
  const [manualOwner, setManualOwner] = useState(task.manualAssignee || "");
  const [priority, setPriority] = useState<1 | 2 | 3>(task.priority || 2);
  const [privateNote, setPrivateNote] = useState("");
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [candidates, setCandidates] = useState<CandidateTask[]>([]);
  const [predecessor, setPredecessor] = useState("");
  const [dependencyType, setDependencyType] = useState<TaskDependency["type"]>("finish_start");
  const [lagDays, setLagDays] = useState(0);
  const [activePanel, setActivePanel] = useState<"details" | "subtasks" | "dependencies" | "notes">("details");
  const [rollupEnabled, setRollupEnabled] = useState(Boolean(task.rollupProgress));
  const [subtaskParent, setSubtaskParent] = useState(task.id);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskStart, setSubtaskStart] = useState(task.startDate || "");
  const [subtaskDue, setSubtaskDue] = useState(task.dueDate || "");
  const [subtaskOwner, setSubtaskOwner] = useState(task.manualAssignee ? "__manual__" : task.assigneeId || "");
  const [subtaskManualOwner, setSubtaskManualOwner] = useState(task.manualAssignee || "");
  const [busy, setBusy] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");
  const statusOptions = projectStatuses.filter((item) => item.enabled || item.status === status).map((item) => ({ value: item.status, label: item.label }));
  const chosenMembers = useMemo(() => members.filter((member) => selectedAssignees.includes(member.user_id)), [members, selectedAssignees]);
  const toggleAssignee = (id: string) => setSelectedAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const currentDepth = taskDepth(task, allTasks);
  const directChildren = sortTasksByDate(allTasks.filter((item) => item.parentId === task.id));
  const directChildIds = new Set(directChildren.map((item) => item.id));
  const grandChildren = sortTasksByDate(allTasks.filter((item) => item.parentId && directChildIds.has(item.parentId)));
  const descendants = [...directChildren, ...grandChildren];
  const allowedParents = currentDepth >= 2 ? [] : [task, ...(currentDepth === 0 ? directChildren : [])];

  const loadContext = async () => {
    if (!hasSupabaseConfig) { setLoadingContext(false); return; }
    setLoadingContext(true); setError("");
    const supabase = createClient()!;
    const [{ data: authData }, noteResult, dependencyResult, candidateResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("task_private_notes").select("body").eq("task_id", task.id).maybeSingle(),
      supabase.from("task_dependencies").select("id,dependency_type,lag_days,predecessor:tasks!task_dependencies_predecessor_task_id_fkey(id,title,status,projects!tasks_project_id_fkey(name,code))").eq("successor_task_id", task.id),
      supabase.from("tasks").select("id,title,projects!tasks_project_id_fkey(name,code)").neq("id", task.id).order("title").limit(300),
    ]);
    if (noteResult.data && authData.user) setPrivateNote(noteResult.data.body || "");
    if (noteResult.error || dependencyResult.error || candidateResult.error) {
      const contextError = noteResult.error || dependencyResult.error || candidateResult.error;
      setError(contextError?.code === "42P01" || contextError?.code === "PGRST205" ? "Falta aplicar la migración 202607140006_task_management.sql." : contextError?.message || "No se pudo cargar el detalle.");
    }
    const rows = (dependencyResult.data || []) as unknown as DependencyRow[];
    setDependencies(rows.map((row) => {
      const project = Array.isArray(row.predecessor?.projects) ? row.predecessor?.projects[0] : row.predecessor?.projects;
      return { id: row.id, predecessorId: row.predecessor?.id || "", predecessorTitle: row.predecessor?.title || "Tarea eliminada", predecessorProject: project ? `${project.code} · ${project.name}` : "Proyecto", predecessorStatus: row.predecessor?.status || "todo", type: row.dependency_type, lagDays: row.lag_days };
    }));
    setCandidates(((candidateResult.data || []) as unknown as Array<{ id: string; title: string; projects?: { name: string; code: string } | { name: string; code: string }[] | null }>).map((row) => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      return { id: row.id, title: row.title, projectName: project?.name || "Proyecto", projectCode: project?.code || "—" };
    }));
    setLoadingContext(false);
  };

  useEffect(() => { loadContext(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rollupEnabled) { setProgress(task.progress); setStatus(task.status); } }, [rollupEnabled, task.progress, task.status]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true); setError("");
    const finalProgress = status === "done" ? 100 : progress;
    const effectiveActualDate = actualCompletionDate;
    let resolvedDirectoryIds = chosenMembers.filter((member) => member.user_id.startsWith("external:")).map((member) => member.user_id.replace("external:", ""));
    if (hasSupabaseConfig) {
      const supabase = createClient()!;
      let manualDirectoryId: string | null = null;
      if (manualOwner.trim()) {
        const remembered = await supabase.rpc("remember_external_assignee", { target_project: task.projectId, assignee_name: manualOwner.trim() });
        if (remembered.error) { setError(remembered.error.message); setBusy(false); return; }
        manualDirectoryId = String(remembered.data);
      }
      const registeredIds = chosenMembers.filter((member) => !member.user_id.startsWith("external:")).map((member) => member.user_id);
      const directoryIds = Array.from(new Set([
        ...chosenMembers.filter((member) => member.user_id.startsWith("external:")).map((member) => member.user_id.replace("external:", "")),
        ...(manualDirectoryId ? [manualDirectoryId] : []),
      ]));
      resolvedDirectoryIds = directoryIds;
      const firstRegistered = registeredIds[0] || null;
      const firstDirectory = chosenMembers.find((member) => member.user_id.startsWith("external:"))?.full_name || manualOwner.trim() || null;
      const { error: updateError } = await supabase.rpc("update_task_details", {
        target_task: task.id, task_title: title, task_description: description, task_section: section,
        task_start: startDate || null, task_due: dueDate || null, task_status: status,
        task_progress: finalProgress, task_is_milestone: isMilestone, task_color: color,
        target_assignee: firstRegistered,
        assignee_label: firstRegistered ? null : firstDirectory,
      });
      if (updateError) { setError(updateError.code === "PGRST202" ? "Falta aplicar la migración 202607140006_task_management.sql." : updateError.message); setBusy(false); return; }
      const { error: priorityError } = await supabase.rpc("set_task_priority", { target_task: task.id, next_priority: priority });
      if (priorityError) { setError(priorityError.code === "PGRST202" ? "Falta aplicar la migración 202607150009_task_priority_external_assignees.sql." : priorityError.message); setBusy(false); return; }
      const { error: assigneeError } = await supabase.rpc("set_task_assignees", { target_task: task.id, target_users: registeredIds, target_directory_assignees: directoryIds });
      if (assigneeError) { setError(assigneeError.code === "PGRST202" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : assigneeError.message); setBusy(false); return; }
      const { error: dateError } = await supabase.rpc("update_task_dates", { target_task: task.id, task_start: startDate || null, task_due: dueDate || null, task_actual: effectiveActualDate || null });
      if (dateError) { setError(dateError.code === "PGRST202" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : dateError.message); setBusy(false); return; }
      if (rollupEnabled) await supabase.rpc("set_task_rollup", { target_task: task.id, rollup_enabled: true });
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const noteResult = privateNote.trim()
          ? await supabase.from("task_private_notes").upsert({ task_id: task.id, user_id: authData.user.id, body: privateNote.trim() }, { onConflict: "task_id,user_id" })
          : await supabase.from("task_private_notes").delete().eq("task_id", task.id).eq("user_id", authData.user.id);
        if (noteResult.error) { setError(noteResult.error.message); setBusy(false); return; }
      }
    }
    const due = dueDate ? format(new Date(`${dueDate}T12:00:00`), "dd MMM", { locale: es }) : "Sin fecha";
    const owners = [
      ...chosenMembers.map((member) => member.user_id.startsWith("external:") ? { ...memberToPerson(undefined, member.full_name), id: member.user_id, directoryId: member.user_id.replace("external:", "") } : memberToPerson(member)),
      ...(manualOwner.trim() && !chosenMembers.some((member) => member.full_name.toLowerCase() === manualOwner.trim().toLowerCase()) ? [{ ...memberToPerson(undefined, manualOwner.trim()), directoryId: resolvedDirectoryIds.find((id) => !chosenMembers.some((member) => member.user_id === `external:${id}`)) }] : []),
    ];
    onUpdated({ ...task, title: title.trim(), description: description.trim(), section, startDate, dueDate, actualCompletionDate: effectiveActualDate, due, status: finalProgress === 100 ? "done" : status, progress: finalProgress, priority, isMilestone, color, assigneeId: owners.find((owner) => !owner.directoryId && !owner.id.startsWith("manual-"))?.id, assigneeIds: chosenMembers.filter((member) => !member.user_id.startsWith("external:")).map((member) => member.user_id), directoryAssigneeIds: owners.map((owner) => owner.directoryId).filter((id): id is string => Boolean(id)), manualAssignee: owners.find((owner) => owner.directoryId || owner.id.startsWith("manual-"))?.name, owners, owner: owners[0] || memberToPerson() });
    setBusy(false); onClose();
  };

  const removeTask = async () => {
    if (!canEdit || !window.confirm(`¿Eliminar “${task.title}”? Esta acción también quitará sus relaciones y notas.`)) return;
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: removeError } = await createClient()!.rpc("delete_task", { target_task: task.id });
      if (removeError) { setError(removeError.message); setBusy(false); return; }
    }
    onDeleted(task.id); onClose();
  };

  const addDependency = async () => {
    if (!predecessor || !canEdit) return;
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: dependencyError } = await createClient()!.rpc("add_task_dependency", { target_predecessor: predecessor, target_successor: task.id, target_type: dependencyType, target_lag_days: lagDays });
      if (dependencyError) { setError(dependencyError.message); setBusy(false); return; }
    }
    setPredecessor(""); await loadContext(); setBusy(false);
  };

  const removeDependency = async (dependencyId: string) => {
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: dependencyError } = await createClient()!.rpc("remove_task_dependency", { target_dependency: dependencyId });
      if (dependencyError) { setError(dependencyError.message); setBusy(false); return; }
    }
    setDependencies((current) => current.filter((item) => item.id !== dependencyId)); setBusy(false);
  };

  const toggleRollup = async (enabled: boolean) => {
    if (!canEdit) return;
    setRollupEnabled(enabled); setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: rollupError } = await createClient()!.rpc("set_task_rollup", { target_task: task.id, rollup_enabled: enabled });
      if (rollupError) { setRollupEnabled(!enabled); setError(rollupError.code === "PGRST202" ? "Falta aplicar la migración 202607140007_subtasks_followups.sql." : rollupError.message); setBusy(false); return; }
    }
    const rolledProgress = enabled && directChildren.length ? Math.round(directChildren.reduce((sum, child) => sum + child.progress, 0) / directChildren.length) : task.progress;
    setProgress(rolledProgress); if (rolledProgress === 100) setStatus("done"); else if (status === "done") setStatus("progress");
    onUpdated({ ...task, rollupProgress: enabled, progress: rolledProgress, status: rolledProgress === 100 ? "done" : task.status === "done" ? "progress" : task.status });
    setBusy(false);
  };

  const createChild = async () => {
    const parent = allTasks.find((item) => item.id === subtaskParent) || task;
    const cleanTitle = subtaskTitle.trim();
    if (!cleanTitle || !canEdit) return;
    setBusy(true); setError("");
    let newId = `local-${Date.now()}`;
    let childDirectoryId: string | null = null;
    if (hasSupabaseConfig) {
      const externalChoice = members.find((item) => item.user_id === subtaskOwner && item.user_id.startsWith("external:"));
      const externalLabel = externalChoice?.full_name || (subtaskOwner === "__manual__" ? subtaskManualOwner.trim() : "");
      const { data, error: childError } = await createClient()!.rpc("create_subtask", {
        target_parent: parent.id, task_title: cleanTitle, task_start: subtaskStart || null,
        task_due: subtaskDue || null, target_assignee: subtaskOwner && subtaskOwner !== "__manual__" && !subtaskOwner.startsWith("external:") ? subtaskOwner : null,
        assignee_label: externalLabel || null,
      });
      if (childError) { setError(childError.code === "PGRST202" ? "Falta aplicar la migración 202607140007_subtasks_followups.sql." : childError.message); setBusy(false); return; }
      newId = String(data);
      if (subtaskOwner === "__manual__" && subtaskManualOwner.trim()) {
        const remembered = await createClient()!.rpc("remember_external_assignee", { target_project: task.projectId, assignee_name: subtaskManualOwner.trim() });
        if (remembered.data) childDirectoryId = String(remembered.data);
      } else if (subtaskOwner.startsWith("external:")) childDirectoryId = subtaskOwner.replace("external:", "");
      const childUserId = subtaskOwner && subtaskOwner !== "__manual__" && !subtaskOwner.startsWith("external:") ? subtaskOwner : null;
      await createClient()!.rpc("set_task_assignees", { target_task: newId, target_users: childUserId ? [childUserId] : [], target_directory_assignees: childDirectoryId ? [childDirectoryId] : [] });
    }
    const choice = members.find((item) => item.user_id === subtaskOwner);
    const member = choice?.user_id.startsWith("external:") ? undefined : choice;
    const externalName = choice?.user_id.startsWith("external:") ? choice.full_name : subtaskOwner === "__manual__" ? subtaskManualOwner.trim() : undefined;
    const start = subtaskStart ? new Date(`${subtaskStart}T12:00:00`) : new Date();
    const due = subtaskDue ? new Date(`${subtaskDue}T12:00:00`) : start;
    const childOwner = memberToPerson(member, externalName);
    if (childDirectoryId) childOwner.directoryId = childDirectoryId;
    onCreated({ id: newId, projectId: task.projectId, parentId: parent.id, title: cleanTitle, description: "", section: parent.section, owner: childOwner, owners: childOwner.id === "unassigned" ? [] : [childOwner], assigneeId: member?.user_id, assigneeIds: member ? [member.user_id] : [], directoryAssigneeIds: childDirectoryId ? [childDirectoryId] : [], manualAssignee: externalName, start: 1, duration: Math.max(1, differenceInCalendarDays(due, start) + 1), progress: 0, priority: parent.priority || 2, status: "todo", due: subtaskDue ? format(due, "dd MMM", { locale: es }) : "Sin fecha", startDate: subtaskStart, dueDate: subtaskDue, color: parent.color || "#2f7669", rollupProgress: false });
    setSubtaskTitle(""); setSubtaskManualOwner(""); setBusy(false); await loadContext();
  };

  return <div className="modal-layer task-editor-layer" role="dialog" aria-modal="true" aria-label={`Editar ${task.title}`}>
    <button className="modal-backdrop" onClick={onClose} />
    <section className="modal-card task-editor-modal">
      <header className="task-editor-head">
        <div><span className="eyebrow">TAREA · {task.section}</span><h2>{task.title}</h2><p>{task.owner.name} · {task.progress}% completado</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
      </header>
      <nav className="task-editor-tabs">
        <button type="button" className={activePanel === "details" ? "active" : ""} onClick={() => setActivePanel("details")}>Detalles</button>
        <button type="button" className={activePanel === "subtasks" ? "active" : ""} onClick={() => setActivePanel("subtasks")}>Subtareas <span>{descendants.length}</span></button>
        <button type="button" className={activePanel === "dependencies" ? "active" : ""} onClick={() => setActivePanel("dependencies")}>Bloqueos <span>{dependencies.length}</span></button>
        <button type="button" className={activePanel === "notes" ? "active" : ""} onClick={() => setActivePanel("notes")}>Mis apuntes</button>
      </nav>
      <form className="task-editor-form" onSubmit={save}>
        <div className="task-editor-scroll">
          {activePanel === "details" && <div className="task-editor-main">
            <label className="field-label">Nombre<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} required /></label>
            <label className="field-label">Descripción compartida<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit} rows={4} placeholder="Contexto, entregables y criterios de aceptación…" /></label>
            <div className="form-grid"><label className="field-label">Sección<select value={section} onChange={(event) => setSection(event.target.value)} disabled={!canEdit}>{sections.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="field-label">Estado<select value={status} onChange={(event) => { const next = event.target.value as TaskStatus; setStatus(next); if (next === "done") setProgress(100); else setActualCompletionDate(""); }} disabled={!canEdit}>{statusOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label></div>
            <div className="form-grid three-dates"><label className="field-label">Inicio<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={!canEdit} /></label><label className="field-label">Fecha límite<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={!canEdit} /></label><label className={`field-label ${actualCompletionDate && dueDate && actualCompletionDate > dueDate ? "actual-date-late" : ""}`}>Fecha real<input type="date" value={actualCompletionDate} onChange={(event) => { setActualCompletionDate(event.target.value); if (event.target.value) { setStatus("done"); setProgress(100); } }} disabled={!canEdit} /><small>{actualCompletionDate && dueDate && actualCompletionDate > dueDate ? `${differenceInCalendarDays(new Date(`${actualCompletionDate}T12:00:00`), new Date(`${dueDate}T12:00:00`))} días después del límite` : "Cierre efectivo"}</small></label></div>
            <label className={`progress-editor ${rollupEnabled ? "calculated" : ""}`}><span><b>{rollupEnabled ? "Avance calculado desde subtareas" : "Avance de la tarea"}</b><output>{progress}%</output></span><input type="range" min="0" max="100" step="5" value={progress} onChange={(event) => { const next = Number(event.target.value); setProgress(next); if (next === 100) setStatus("done"); else if (status === "done") { setStatus("progress"); setActualCompletionDate(""); } }} disabled={!canEdit || rollupEnabled} /><i style={{ width: `${progress}%`, background: color }} /></label>
            <div className="form-grid assignee-priority-grid"><div className="multi-assignee-field"><span>Responsables</span><div>{members.map((member) => <label className={selectedAssignees.includes(member.user_id) ? "selected" : ""} key={member.user_id}><input type="checkbox" checked={selectedAssignees.includes(member.user_id)} onChange={() => toggleAssignee(member.user_id)} disabled={!canEdit} /><i>{initials(member.full_name)}</i><b>{member.full_name || member.email}</b><Check size={12} /></label>)}{!members.length && <small>No hay integrantes ni responsables guardados.</small>}</div><label className="new-project-assignee"><span>Agregar responsable del proyecto</span><input value={manualOwner} onChange={(event) => setManualOwner(event.target.value)} disabled={!canEdit} placeholder="Nombre de proveedor, contacto o apoyo" /><small>Quedará disponible para las próximas tareas.</small></label></div><label className="field-label">Prioridad<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3)} disabled={!canEdit}><option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option></select></label></div>
            <label className="field-label task-color-field">Color manual<input className="task-editor-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={!canEdit} /></label>
            <label className="switch-row"><span><b>Es un hito</b><small>Se mostrará como un punto sin duración.</small></span><input type="checkbox" checked={isMilestone} onChange={(event) => setIsMilestone(event.target.checked)} disabled={!canEdit} /><i /></label>
          </div>}

          {activePanel === "subtasks" && <div className="subtask-panel">
            <div className="editor-panel-intro"><span className="eyebrow">DESGLOSE</span><h3>Subtareas de {task.title}</h3><p>Puedes crear dos niveles bajo una tarea. Cada nivel puede resumir automáticamente el avance de sus hijos.</p></div>
            <label className="rollup-choice"><span><b>Calcular avance desde subtareas</b><small>El porcentaje de esta tarea será el promedio de sus hijas directas.</small></span><input type="checkbox" checked={rollupEnabled} onChange={(event) => toggleRollup(event.target.checked)} disabled={!canEdit || busy} /><i /></label>
            <div className="subtask-tree">{directChildren.map((child) => <div key={child.id} className="subtask-branch"><button type="button" onClick={() => onSelectTask(child)}><span className="tree-line"><i style={{ background: child.color }} /></span><div><b>{child.title}</b><small>{child.startDate || "Sin inicio"} · {child.owner.name}</small></div><span className="tree-progress"><i style={{ width: `${child.progress}%`, background: child.color }} /><b>{child.progress}%</b></span></button>{grandChildren.filter((item) => item.parentId === child.id).map((grandChild) => <button type="button" className="subtask-grandchild" key={grandChild.id} onClick={() => onSelectTask(grandChild)}><span className="tree-line"><i style={{ background: grandChild.color }} /></span><div><b>{grandChild.title}</b><small>{grandChild.startDate || "Sin inicio"} · {grandChild.owner.name}</small></div><span className="tree-progress"><i style={{ width: `${grandChild.progress}%`, background: grandChild.color }} /><b>{grandChild.progress}%</b></span></button>)}</div>)}{!directChildren.length && <div className="subtask-empty"><ListTree size={22} /><b>Sin subtareas todavía</b><span>Desglosa esta actividad cuando necesites un seguimiento más preciso.</span></div>}</div>
            {canEdit && allowedParents.length > 0 && <div className="subtask-create"><h4>Agregar {currentDepth === 0 ? "subtarea" : "sub-subtarea"}</h4>{allowedParents.length > 1 && <label className="field-label">Depende de<select value={subtaskParent} onChange={(event) => setSubtaskParent(event.target.value)}>{allowedParents.map((item) => <option value={item.id} key={item.id}>{item.id === task.id ? task.title : `↳ ${item.title}`}</option>)}</select></label>}<label className="field-label">Nombre<input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Ej. Validar planos del proveedor" required /></label><div className="form-grid"><label className="field-label">Inicio<input type="date" value={subtaskStart} onChange={(event) => setSubtaskStart(event.target.value)} /></label><label className="field-label">Término<input type="date" value={subtaskDue} onChange={(event) => setSubtaskDue(event.target.value)} /></label></div><label className="field-label">Responsable<select value={subtaskOwner} onChange={(event) => setSubtaskOwner(event.target.value)}><option value="">Sin asignar</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.full_name || member.email}</option>)}<option value="__manual__">Nombre externo o ficticio</option></select></label>{subtaskOwner === "__manual__" && <label className="field-label">Nombre<input value={subtaskManualOwner} onChange={(event) => setSubtaskManualOwner(event.target.value)} required /></label>}<button type="button" className="button secondary" onClick={createChild} disabled={busy || !subtaskTitle.trim()}><Plus size={15} /> Crear subtarea</button></div>}
            {currentDepth >= 2 && <div className="depth-limit-note"><ListTree size={16} /> Este es el último nivel permitido de la jerarquía.</div>}
          </div>}

          {activePanel === "dependencies" && <div className="task-dependency-editor">
            <div className="editor-panel-intro"><span className="eyebrow">RELACIONES</span><h3>Tareas que bloquean esta actividad</h3><p>Orbit impedirá que crees ciclos entre tareas.</p></div>
            <div className="dependency-editor-list">{dependencies.map((item) => <article key={item.id}><span className={`dependency-state ${item.predecessorStatus === "done" ? "done" : "pending"}`}>{item.predecessorStatus === "done" ? <Check size={13} /> : <AlertTriangle size={13} />}</span><div><b>{item.predecessorTitle}</b><small>{item.predecessorProject} · {dependencyTypes.find((type) => type.value === item.type)?.label}{item.lagDays ? ` · ${item.lagDays} d` : ""}</small></div>{canEdit && <button type="button" onClick={() => removeDependency(item.id)} disabled={busy} title="Quitar relación"><X size={14} /></button>}</article>)}{!dependencies.length && <div className="dependency-editor-empty"><Link2 size={20} /><b>Sin tareas bloqueantes</b><span>Esta tarea puede avanzar de forma independiente.</span></div>}</div>
            {canEdit && <div className="dependency-add"><label className="field-label">Tarea que bloquea<select value={predecessor} onChange={(event) => setPredecessor(event.target.value)} disabled={loadingContext}><option value="">Seleccionar tarea…</option>{candidates.map((item) => <option value={item.id} key={item.id}>{item.projectCode} · {item.title}</option>)}</select></label><div className="form-grid"><label className="field-label">Tipo<select value={dependencyType} onChange={(event) => setDependencyType(event.target.value as TaskDependency["type"])}>{dependencyTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label className="field-label">Espera adicional<input type="number" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} /></label></div><button type="button" className="button secondary" onClick={addDependency} disabled={!predecessor || busy}><Plus size={15} /> Agregar relación</button></div>}
          </div>}

          {activePanel === "notes" && <div className="private-note-panel"><span className="private-note-icon"><UserRound size={20} /></span><div><span className="eyebrow">ESPACIO PERSONAL</span><h3>Apuntes privados</h3><p>Solo tú puedes leer este contenido. No aparecerá en exportaciones ni en la actividad del equipo.</p></div><label className="field-label"><textarea value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} rows={12} placeholder="Decisiones pendientes, recordatorios, contexto para la próxima reunión…" /></label></div>}
          {error && <p className="form-error task-editor-error">{error}</p>}
        </div>
        <footer className="task-editor-actions">{canEdit && <button type="button" className="button danger-outline" onClick={removeTask} disabled={busy}><Trash2 size={15} /> Eliminar</button>}<span /><button type="button" className="button secondary" onClick={onClose}>Cerrar</button>{canEdit && <button className="button primary" disabled={busy}><Save size={15} /> {busy ? "Guardando…" : "Guardar"}</button>}</footer>
      </form>
    </section>
  </div>;
}
