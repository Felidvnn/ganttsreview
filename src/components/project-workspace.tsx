"use client";

import { Activity, AlertTriangle, BarChart3, CalendarCheck, Clock3, Columns3, Download, FileCode2, FileImage, FileSpreadsheet, FileText, GanttChart, History, LayoutList, Milestone, Pencil, RefreshCw, Settings2 } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Task, TaskStatus } from "@/lib/types";
import { defaultProjectStatuses, statusLabel, type ProjectTaskStatus } from "@/lib/task-statuses";
import { defaultProjectTaskTypes, taskTypeLabel, type ProjectTaskType } from "@/lib/task-types";
import { taskDisplayColor, type TaskColorMode } from "@/lib/task-colors";
import { applyTaskRollups, sortTasksByDate, taskDateKey, taskDepth, taskDisplaySection, taskHierarchyPath } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { GanttBoard } from "./gantt-board";
import { ProjectDelays } from "./project-delays";
import { ProjectStatusSettings } from "./project-status-settings";
import { ProjectTypeSettings } from "./project-type-settings";
import { TaskBadge } from "./status";
import { TaskEditor, type AssignableMember } from "./task-editor";

type ProjectView = "gantt" | "list" | "board" | "milestones" | "delays" | "reports" | "activity";
type ActivityRow = { id: number; actor_name: string; action: string; entity_title: string; created_at: string };

const actionLabels: Record<string, string> = { insert: "creó", update: "actualizó", delete: "eliminó" };

function htmlCell(value: unknown) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function downloadBlob(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function polishedReportHtml(project: Project, tasks: Task[], statuses: ProjectTaskStatus[]) {
  const ordered = sortTasksByDate(tasks);
  const sections = Array.from(new Set(ordered.map((task) => taskDisplaySection(task, ordered))));
  const rows = sections.map((section) => {
    const sectionTasks = ordered.filter((task) => taskDisplaySection(task, ordered) === section);
    return `<tr class="section"><td colspan="8"><strong>${htmlCell(section)}</strong><span>${sectionTasks.length} actividades</span></td></tr>${sectionTasks.map((task) => {
      const depth = taskDepth(task, ordered);
      const priority = task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media";
      return `<tr class="task level-${depth}"><td><div class="tree depth-${depth}"><i></i><span><strong>${htmlCell(task.title)}</strong><small>${depth === 2 ? "Sub-subtarea" : depth === 1 ? "Subtarea" : "Tarea principal"}</small></span></div></td><td>${htmlCell(task.owners?.map((owner) => owner.name).join(", ") || task.owner.name)}</td><td><span class="priority p-${priority.toLowerCase()}">${priority}</span></td><td><span class="state" style="--state:${statuses.find((item) => item.status === task.status)?.color || "#68766f"}">${htmlCell(statusLabel(task.status, statuses))}</span></td><td><div class="bar"><i style="width:${task.progress}%;background:${task.color || "#2f7669"}"></i></div><b>${task.progress}%</b></td><td><b>${htmlCell(task.startDate || "Sin inicio")}</b></td><td><b>${htmlCell(task.dueDate || "Sin término")}</b></td><td>${htmlCell(`${task.description || "—"}${task.actualCompletionDate ? ` · Fecha real: ${task.actualCompletionDate}` : ""}`)}</td></tr>`;
    }).join("")}`;
  }).join("");
  const roots = ordered.filter((task) => !task.parentId);
  const progress = roots.length ? Math.round(roots.reduce((sum, task) => sum + task.progress, 0) / roots.length) : 0;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlCell(project.code)} · ${htmlCell(project.name)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#20342c;background:#eef3f0;font-family:Inter,Segoe UI,Arial,sans-serif}.page{max-width:1450px;margin:24px auto;padding:30px;background:#fff;border:1px solid #dce5e1;border-radius:16px;box-shadow:0 18px 55px rgba(21,52,42,.08)}header{display:flex;justify-content:space-between;gap:30px;padding-bottom:22px;border-bottom:1px solid #e2e9e5}.code{display:inline-flex;padding:5px 8px;color:#27695b;background:#eaf4f0;border-radius:6px;font-size:10px;font-weight:800;letter-spacing:.7px}h1{margin:9px 0 6px;font-size:26px}header p{max-width:720px;margin:0;color:#718079;font-size:11px;line-height:1.5}.generated{color:#87938d;font-size:10px;white-space:nowrap}.metrics{margin:18px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.metric{padding:13px;border:1px solid #e1e8e4;border-radius:9px;background:#fafcfb}.metric span{display:block;color:#83908a;font-size:8px;font-weight:750;letter-spacing:.5px}.metric b{display:block;margin-top:5px;font-size:20px}table{width:100%;border-spacing:0;border:1px solid #dfe7e3;border-radius:11px;overflow:hidden}th{padding:10px;color:#74817b;background:#f2f6f4;font-size:8px;letter-spacing:.5px;text-align:left;text-transform:uppercase}td{padding:10px;border-top:1px solid #e9eeeb;font-size:9px;vertical-align:middle}.section td{padding:9px 11px;color:#315d50;background:#eaf2ef}.section td strong{font-size:9px;text-transform:uppercase;letter-spacing:.5px}.section td span{float:right;color:#81908a;font-size:7px}.task.level-1,.task.level-2{background:#fbfcfb}.tree{display:flex;align-items:center;min-width:210px}.tree.depth-1{padding-left:22px}.tree.depth-2{padding-left:44px}.tree>i{width:12px;height:14px;margin-right:7px;border-left:1px solid #aebfb8;border-bottom:1px solid #aebfb8}.tree.depth-0>i{display:none}.tree span{display:flex;flex-direction:column}.tree strong{font-size:9px}.tree small{margin-top:3px;color:#87938d;font-size:6.5px}.priority,.state{padding:4px 7px;border-radius:8px;font-size:7px;font-weight:700}.p-alta{color:#a34f42;background:#fff0ed}.p-media{color:#97662d;background:#fff5e7}.p-baja{color:#617b72;background:#edf3f1}.state{color:var(--state);background:color-mix(in srgb,var(--state) 11%,white)}.bar{display:inline-block;width:65px;height:4px;margin-right:6px;overflow:hidden;border-radius:5px;background:#e4ebe8;vertical-align:middle}.bar i{display:block;height:100%}td>b{font-size:8px;white-space:nowrap}@media(max-width:900px){.page{margin:0;padding:16px;border:0;border-radius:0;overflow-x:auto}.metrics{grid-template-columns:1fr 1fr}table{min-width:1050px}}@media print{body{background:white}.page{max-width:none;margin:0;padding:0;border:0;box-shadow:none}header{break-after:avoid}.section{break-after:avoid}tr{break-inside:avoid}@page{size:landscape;margin:9mm}}
  </style></head><body><main class="page"><header><div><span class="code">${htmlCell(project.code)}</span><h1>${htmlCell(project.name)}</h1><p>${htmlCell(project.description || "Planificación general del proyecto")}</p></div><span class="generated">Generado ${new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date())}</span></header><section class="metrics"><div class="metric"><span>AVANCE</span><b>${progress}%</b></div><div class="metric"><span>TAREAS PRINCIPALES</span><b>${roots.length}</b></div><div class="metric"><span>SUBTAREAS</span><b>${ordered.filter((task) => task.parentId).length}</b></div><div class="metric"><span>PERIODO</span><b>${htmlCell(project.startDate || "—")} · ${htmlCell(project.dueDate || "—")}</b></div></section><table><thead><tr><th>Tarea</th><th>Responsable</th><th>Prioridad</th><th>Estado</th><th>Avance</th><th>Inicio</th><th>Fin</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

function excelWorkbook(project: Project, tasks: Task[], statuses: ProjectTaskStatus[]) {
  const ordered = sortTasksByDate(tasks);
  const xml = (value: unknown) => htmlCell(value);
  const cell = (value: unknown, style = "Text") => `<Cell ss:StyleID="${style}"><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${xml(value)}</Data></Cell>`;
  const header = ["Nivel", "Jerarquía", "Tarea", "Tarea padre", "Sección", "Responsables", "Prioridad", "Estado", "Avance (%)", "Inicio", "Fin", "Fecha real", "Tipo", "Descripción"].map((value) => cell(value, "Header")).join("");
  const rows = ordered.map((task) => {
    const depth = taskDepth(task, ordered); const parent = task.parentId ? ordered.find((item) => item.id === task.parentId) : undefined;
    const priority = task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media";
    const values: Array<[unknown, string?]> = [
      [depth === 2 ? "Sub-subtarea" : depth === 1 ? "Subtarea" : "Tarea principal"], [taskHierarchyPath(task, ordered)], [task.title, `Level${depth}`], [parent?.title || ""], [taskDisplaySection(task, ordered)], [task.owners?.map((owner) => owner.name).join(", ") || task.owner.name], [priority, `Priority${priority}`], [statusLabel(task.status, statuses)], [task.progress, "Number"], [task.startDate || "Sin inicio", "Date"], [task.dueDate || "Sin término", "Date"], [task.actualCompletionDate || "", "Date"], [task.taskTypeName || (task.isMilestone ? "Hito" : "Tarea")], [task.description || ""],
    ];
    return `<Row>${values.map(([value, style]) => cell(value, style)).join("")}</Row>`;
  }).join("");
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10"/></Style><Style ss:ID="Text"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5EAE7"/></Borders></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#245F55" ss:Pattern="Solid"/><Alignment ss:WrapText="1"/></Style><Style ss:ID="Level0"><Font ss:Bold="1"/></Style><Style ss:ID="Level1"><Alignment ss:Indent="2"/><Interior ss:Color="#F8FBF9" ss:Pattern="Solid"/></Style><Style ss:ID="Level2"><Alignment ss:Indent="4"/><Interior ss:Color="#F2F7F4" ss:Pattern="Solid"/></Style><Style ss:ID="PriorityAlta"><Font ss:Color="#A34F42" ss:Bold="1"/><Interior ss:Color="#FFF0ED" ss:Pattern="Solid"/></Style><Style ss:ID="PriorityMedia"><Font ss:Color="#97662D"/><Interior ss:Color="#FFF5E7" ss:Pattern="Solid"/></Style><Style ss:ID="PriorityBaja"><Font ss:Color="#617B72"/><Interior ss:Color="#EDF3F1" ss:Pattern="Solid"/></Style><Style ss:ID="Number"><NumberFormat ss:Format="0"/><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="Date"><Alignment ss:Horizontal="Center"/></Style></Styles><Worksheet ss:Name="Planificación"><Table><Column ss:Width="92"/><Column ss:Width="210"/><Column ss:Width="220"/><Column ss:Width="180"/><Column ss:Width="120"/><Column ss:Width="130"/><Column ss:Width="75"/><Column ss:Width="90"/><Column ss:Width="70"/><Column ss:Width="82"/><Column ss:Width="82"/><Column ss:Width="60"/><Column ss:Width="260"/><Row ss:Height="28">${header}</Row>${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><AutoFilter x:Range="R1C1:R${ordered.length + 1}C13" xmlns:x="urn:schemas-microsoft-com:office:excel"/></WorksheetOptions></Worksheet></Workbook>`;
}

export function ProjectWorkspace({ project, initialTasks, canEdit }: { project: Project; initialTasks: Task[]; canEdit: boolean }) {
  const [tasks, setTasks] = useState(() => sortTasksByDate(initialTasks));
  const [view, setView] = useState<ProjectView>("gantt");
  const [colorMode, setColorMode] = useState<TaskColorMode>("manual");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [projectStatuses, setProjectStatuses] = useState<ProjectTaskStatus[]>(defaultProjectStatuses);
  const [projectTaskTypes, setProjectTaskTypes] = useState<ProjectTaskType[]>(defaultProjectTaskTypes);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [typeSettingsOpen, setTypeSettingsOpen] = useState(false);
  const sections = useMemo(() => Array.from(new Set(tasks.map((task) => task.section))).sort((left, right) => {
    const leftTask = tasks.find((task) => task.section === left);
    const rightTask = tasks.find((task) => task.section === right);
    return (leftTask ? taskDateKey(leftTask) : "9999-12-31").localeCompare(rightTask ? taskDateKey(rightTask) : "9999-12-31");
  }), [tasks]);
  const milestones = tasks.filter((task) => task.isMilestone);
  const completedTasks = tasks.filter((task) => task.status === "done").length;
  const progressBasis = tasks.filter((task) => !task.parentId);
  const currentProgress = progressBasis.length ? Math.round(progressBasis.reduce((sum, task) => sum + task.progress, 0) / progressBasis.length) : 0;
  const nextMilestone = milestones.filter((task) => task.status !== "done" && task.dueDate).sort((left, right) => left.dueDate!.localeCompare(right.dueDate!))[0];
  const milestoneDays = nextMilestone?.dueDate ? differenceInCalendarDays(new Date(`${nextMilestone.dueDate}T12:00:00`), new Date()) : null;
  const handleTasksChange = useCallback((nextTasks: Task[]) => setTasks(applyTaskRollups(nextTasks)), []);
  const statusColumns = useMemo(() => projectStatuses.filter((item) => item.enabled).sort((left, right) => left.sortOrder - right.sortOrder).map((item) => ({ value: item.status, label: item.label })), [projectStatuses]);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    const supabase = createClient()!;
    Promise.all([
      supabase.rpc("get_project_assignable_members", { target_project: project.id }),
      supabase.from("project_task_statuses").select("status,label,color,enabled,sort_order").eq("project_id", project.id).order("sort_order"),
      supabase.from("project_external_assignees").select("id,name").eq("project_id", project.id).order("name"),
      supabase.from("project_task_types").select("id,name,color,sort_order").eq("project_id", project.id).order("sort_order"),
    ]).then(([memberResult, statusResult, externalResult, typeResult]) => {
      setMembers([...(memberResult.data || []) as AssignableMember[], ...((externalResult.data || []).map((item) => ({ user_id: `external:${item.id}`, full_name: item.name, email: "Responsable del proyecto" })))]);
      if (statusResult.data?.length) setProjectStatuses(statusResult.data.map((row) => ({ status: row.status as TaskStatus, label: row.label, color: row.color, enabled: row.enabled, sortOrder: row.sort_order })));
      if (typeResult.data?.length) setProjectTaskTypes(typeResult.data.map((row) => ({ id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order })));
    });
  }, [project.id]);

  const loadActivity = useCallback(async () => {
    if (!hasSupabaseConfig) return;
    setActivityLoading(true); setActivityError("");
    const { data, error } = await createClient()!.rpc("get_project_activity", { target_project: project.id, result_limit: 80 });
    if (error) setActivityError(error.code === "PGRST202" ? "Falta aplicar la migración 202607140006_task_management.sql." : error.message);
    else setActivityRows((data || []) as ActivityRow[]);
    setActivityLoading(false);
  }, [project.id]);

  useEffect(() => { if (view === "activity" && !activityRows.length) loadActivity(); }, [view, activityRows.length, loadActivity]);

  const rememberLocalExternal = (name?: string, directoryId?: string) => {
    if (!name) return;
    setMembers((current) => current.some((member) => member.user_id.startsWith("external:") && member.full_name.toLowerCase() === name.toLowerCase()) ? current : [...current, { user_id: directoryId ? `external:${directoryId}` : `external:local-${encodeURIComponent(name.toLowerCase())}`, full_name: name, email: "Responsable del proyecto" }]);
  };
  const updateLocalTask = (updated: Task) => { setTasks((current) => applyTaskRollups(current.map((task) => task.id === updated.id ? updated : task))); rememberLocalExternal(updated.manualAssignee, updated.directoryAssigneeIds?.[0]); setSelectedTask(updated); };
  const createLocalTask = (created: Task) => { setTasks((current) => applyTaskRollups([...current, created])); rememberLocalExternal(created.manualAssignee, created.directoryAssigneeIds?.[0]); };
  const deleteLocalTask = (taskId: string) => {
    setTasks((current) => {
      const removed = new Set([taskId]);
      let changed = true;
      while (changed) { changed = false; current.forEach((task) => { if (task.parentId && removed.has(task.parentId) && !removed.has(task.id)) { removed.add(task.id); changed = true; } }); }
      return applyTaskRollups(current.filter((task) => !removed.has(task.id)));
    });
    setSelectedTask(null);
  };

  const exportExcel = () => downloadBlob(`${project.code}-planificacion.xls`, excelWorkbook(project, tasks, projectStatuses), "application/vnd.ms-excel;charset=utf-8");
  const exportHtml = () => downloadBlob(`${project.code}-informe.html`, polishedReportHtml(project, tasks, projectStatuses), "text/html;charset=utf-8");
  const exportPdf = () => {
    const popup = window.open("", "_blank", "width=1100,height=800");
    if (!popup) return;
    popup.document.open(); popup.document.write(polishedReportHtml(project, tasks, projectStatuses)); popup.document.close();
    window.setTimeout(() => { popup.focus(); popup.print(); }, 350);
  };
  const exportPng = () => {
    const orderedTasks = sortTasksByDate(tasks);
    const exportSections = Array.from(new Set(orderedTasks.map((task) => taskDisplaySection(task, orderedTasks))));
    const visualRows: Array<{ kind: "section"; name: string } | { kind: "task"; task: Task }> = exportSections.flatMap((section) => [{ kind: "section" as const, name: section }, ...orderedTasks.filter((task) => taskDisplaySection(task, orderedTasks) === section).map((task) => ({ kind: "task" as const, task }))]);
    const width = 1800; const rowHeight = 48; const top = 205; const left = 500; const right = 55; const height = Math.max(520, top + visualRows.length * rowHeight + 70);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) return;
    context.fillStyle = "#f4f7f5"; context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff"; context.beginPath(); context.roundRect(28, 28, width - 56, height - 56, 20); context.fill();
    context.fillStyle = project.color || "#2f7669"; context.beginPath(); context.roundRect(62, 58, 58, 58, 14); context.fill();
    context.fillStyle = "#ffffff"; context.font = "bold 18px Segoe UI, Arial"; context.textAlign = "center"; context.fillText(project.code.slice(0, 2).toUpperCase(), 91, 94); context.textAlign = "left";
    context.fillStyle = "#1d332a"; context.font = "bold 30px Segoe UI, Arial"; context.fillText(project.name.slice(0, 58), 140, 79);
    context.fillStyle = "#7b8983"; context.font = "13px Segoe UI, Arial"; context.fillText(`${project.code}  ·  Informe visual del cronograma`, 140, 104);
    const metrics = [{ label: "AVANCE", value: `${currentProgress}%` }, { label: "TAREAS", value: String(tasks.length) }, { label: "PENDIENTES", value: String(tasks.filter((task) => task.status !== "done").length) }, { label: "BLOQUEADAS", value: String(tasks.filter((task) => task.status === "blocked").length) }];
    metrics.forEach((metric, index) => { const x = 1010 + index * 180; context.fillStyle = "#f5f8f6"; context.beginPath(); context.roundRect(x, 57, 160, 61, 10); context.fill(); context.fillStyle = "#87938d"; context.font = "10px Segoe UI, Arial"; context.fillText(metric.label, x + 15, 78); context.fillStyle = index === 3 ? "#a85143" : "#263a31"; context.font = "bold 20px Segoe UI, Arial"; context.fillText(metric.value, x + 15, 105); });
    const dated = tasks.filter((task) => task.startDate || task.dueDate);
    const dates = dated.flatMap((task) => [task.startDate, task.dueDate].filter(Boolean).map((date) => new Date(`${date}T12:00:00`).getTime()));
    const day = 86400000; const rawMin = dates.length ? Math.min(...dates) : Date.now(); const rawMax = dates.length ? Math.max(...dates) : rawMin + day * 30;
    const min = rawMin - day * 2; const max = Math.max(rawMax + day * 2, min + day * 14); const span = max - min; const timelineWidth = width - left - right;
    context.fillStyle = "#eef3f0"; context.fillRect(58, 147, width - 116, 34); context.fillStyle = "#728079"; context.font = "bold 10px Segoe UI, Arial"; context.fillText("TAREA / RESPONSABLE", 76, 168);
    const dateFormatter = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "2-digit" });
    for (let index = 0; index <= 6; index += 1) { const ratio = index / 6; const x = left + ratio * timelineWidth; context.strokeStyle = "#e2e9e5"; context.lineWidth = 1; context.beginPath(); context.moveTo(x, 147); context.lineTo(x, height - 54); context.stroke(); context.fillStyle = "#7d8a84"; context.font = "10px Segoe UI, Arial"; context.fillText(dateFormatter.format(new Date(min + span * ratio)), x + 7, 168); }
    visualRows.forEach((row, index) => {
      const y = top + index * rowHeight;
      if (row.kind === "section") { context.fillStyle = "#edf4f1"; context.fillRect(58, y - 23, width - 116, rowHeight); context.fillStyle = "#2f6657"; context.font = "bold 12px Segoe UI, Arial"; context.fillText(row.name.toUpperCase(), 76, y + 3); context.fillStyle = "#84938d"; context.font = "10px Segoe UI, Arial"; context.fillText(`${orderedTasks.filter((task) => taskDisplaySection(task, orderedTasks) === row.name).length} actividades`, 360, y + 3); return; }
      const task = row.task; const depth = taskDepth(task, orderedTasks); const taskTextX = 76 + depth * 25; context.fillStyle = depth ? "#fbfcfb" : index % 2 ? "#ffffff" : "#f8faf9"; context.fillRect(58, y - 23, width - 116, rowHeight);
      if (depth) { context.strokeStyle = "#b9c8c2"; context.beginPath(); context.moveTo(taskTextX - 15, y - 13); context.lineTo(taskTextX - 15, y - 1); context.lineTo(taskTextX - 7, y - 1); context.stroke(); }
      context.fillStyle = "#263a31"; context.font = `${depth ? "500" : "600"} 13px Segoe UI, Arial`; context.fillText(task.title.slice(0, 48), taskTextX, y - 3); context.fillStyle = "#83908a"; context.font = "9px Segoe UI, Arial"; context.fillText(`${depth === 2 ? "Sub-subtarea" : depth === 1 ? "Subtarea" : taskDisplaySection(task, orderedTasks)}  ·  ${task.owner.name}  ·  ${task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media"}  ·  Inicio ${task.startDate || "—"}  ·  Fin ${task.dueDate || "—"}`, taskTextX, y + 14);
      const start = task.startDate ? new Date(`${task.startDate}T12:00:00`).getTime() : min; const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).getTime() : start;
      const x = left + (start - min) / span * timelineWidth; const barWidth = Math.max(task.isMilestone ? 15 : 28, (due - start + day) / span * timelineWidth); const taskColor = taskDisplayColor(task, colorMode);
      if (task.isMilestone) { context.save(); context.translate(x + 8, y); context.rotate(Math.PI / 4); context.fillStyle = taskColor; context.beginPath(); context.roundRect(-8, -8, 16, 16, 3); context.fill(); context.restore(); }
      else { context.globalAlpha = .38; context.fillStyle = taskColor; context.beginPath(); context.roundRect(x, y - 13, barWidth, 22, 11); context.fill(); context.globalAlpha = 1; context.fillStyle = taskColor; context.beginPath(); context.roundRect(x, y - 13, Math.max(5, barWidth * task.progress / 100), 22, 11); context.fill(); }
    });
    context.fillStyle = "#9aa49f"; context.font = "10px Segoe UI, Arial"; context.fillText(`Generado por Orbit · ${new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date())}`, 62, height - 43);
    canvas.toBlob((blob) => { if (blob) downloadBlob(`${project.code}-gantt.png`, blob, "image/png"); }, "image/png");
  };

  return <>
    <section className="project-summary-strip">
      <div><small>AVANCE REAL</small><b>{currentProgress}%</b><span className="summary-progress"><i style={{ width: `${currentProgress}%`, background: project.color }} /></span></div>
      <div><small>AVANCE ESPERADO</small><b>{project.expectedProgress}%</b><span className={currentProgress < project.expectedProgress ? "negative" : "positive"}>{currentProgress - project.expectedProgress > 0 ? "+" : ""}{currentProgress - project.expectedProgress} pts</span></div>
      <div><small>TAREAS</small><b>{completedTasks}<em> / {tasks.length}</em></b><span>{tasks.length - completedTasks} pendientes</span></div>
      <div><small>PRÓXIMO HITO</small><b className="summary-text">{nextMilestone?.title ?? "Sin hitos pendientes"}</b><span><Clock3 size={13} />{nextMilestone?.dueDate ? `${format(new Date(`${nextMilestone.dueDate}T12:00:00`), "dd MMM", { locale: es })}${milestoneDays !== null ? ` · ${milestoneDays >= 0 ? `en ${milestoneDays} días` : `atrasado ${Math.abs(milestoneDays)} días`}` : ""}` : "Agrega un hito desde Crear"}</span></div>
    </section>
    <nav className="project-tabs" aria-label="Vistas del proyecto">
      <button className={view === "gantt" ? "active" : ""} onClick={() => setView("gantt")}><GanttChart size={14} /> Gantt</button>
      <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><LayoutList size={14} /> Lista</button>
      <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}><Columns3 size={14} /> Tablero</button>
      <button className={view === "milestones" ? "active" : ""} onClick={() => setView("milestones")}><Milestone size={14} /> Hitos <span>{milestones.length}</span></button>
      <button className={view === "delays" ? "active" : ""} onClick={() => setView("delays")}><History size={14} /> Atrasos <span>{tasks.filter((task) => task.dueDate && ((task.actualCompletionDate && task.actualCompletionDate > task.dueDate) || (!task.actualCompletionDate && task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10)))).length}</span></button>
      <button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}><Download size={14} /> Informes</button>
      <button className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}><Activity size={14} /> Actividad</button>
    </nav>
    <div className="project-view-actions"><div><label className="toolbar-select color-mode-select"><BarChart3 size={15} /> Colorear por <select value={colorMode} onChange={(event) => setColorMode(event.target.value as TaskColorMode)}><option value="manual">Color manual</option><option value="owner">Responsable</option><option value="section">Sección/tema</option><option value="status">Estado</option></select></label>{canEdit && <button className="toolbar-select" onClick={() => setStatusSettingsOpen(true)}><Settings2 size={15} /> Estados</button>}{canEdit && <button className="toolbar-select" onClick={() => setTypeSettingsOpen(true)}><Settings2 size={15} /> Tipos</button>}</div><div><button className="toolbar-select" onClick={exportExcel}><FileSpreadsheet size={15} /> Excel</button><button className="toolbar-select" onClick={exportPdf}><FileText size={15} /> PDF</button></div></div>

    {view === "gantt" && <GanttBoard initialTasks={tasks} projectId={project.id} timelineStart={project.startDate} readOnly={!canEdit} colorMode={colorMode} projectStatuses={projectStatuses} projectTaskTypes={projectTaskTypes} onTasksChange={handleTasksChange} onOpenTask={setSelectedTask} />}
    {view === "list" && <section className="panel project-task-list"><div className="task-list-row task-list-head"><span>Tarea</span><span>Responsable</span><span>Estado</span><span>Avance</span><span>Fecha</span><span /></div>{tasks.map((task) => <article className="task-list-row" key={task.id}><div><i style={{ background: taskDisplayColor(task, colorMode) }} /><span><b>{task.title}</b><small>{taskTypeLabel(task.taskTypeId, projectTaskTypes, task.isMilestone)} · {task.section}{task.description ? ` · ${task.description}` : ""}</small></span></div><span>{task.owner.name}</span><TaskBadge status={task.status} /><div className="list-progress"><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><b>{task.progress}%</b></div><span>{task.dueDate || "Sin fecha"}</span><button className="icon-button" onClick={() => setSelectedTask(task)} title="Abrir tarea"><Pencil size={15} /></button></article>)}{!tasks.length && <div className="view-empty">No hay tareas en este proyecto.</div>}</section>}
    {view === "board" && <section className="project-board">{statusColumns.map((column) => { const columnTasks = tasks.filter((task) => task.status === column.value); return <div className="board-column" key={column.value}><header><span>{column.label}</span><b>{columnTasks.length}</b></header><div>{columnTasks.map((task) => <button className="board-task-card" key={task.id} onClick={() => setSelectedTask(task)} style={{ borderTopColor: taskDisplayColor(task, colorMode) }}><small>{task.section}</small><b>{task.title}</b><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><footer><span>{task.owner.name}</span><strong>{task.progress}%</strong></footer></button>)}{!columnTasks.length && <span className="board-empty">Sin tareas</span>}</div></div>; })}</section>}
    {view === "milestones" && <section className="milestone-view">{milestones.map((task) => <button className="milestone-view-card" key={task.id} onClick={() => setSelectedTask(task)}><span style={{ background: taskDisplayColor(task, colorMode) }}><Milestone /></span><div><small>{task.section}</small><h3>{task.title}</h3><p>{task.description || "Sin descripción"}</p><footer><TaskBadge status={task.status} /><b><CalendarCheck size={14} /> {task.dueDate || "Sin fecha"}</b></footer></div></button>)}{!milestones.length && <div className="view-empty"><Milestone /><b>No hay hitos</b><span>Crea un hito desde la vista Gantt.</span></div>}</section>}
    {view === "delays" && <ProjectDelays projectId={project.id} tasks={tasks} canEdit={canEdit} onOpenTask={setSelectedTask} />}
    {view === "reports" && <section className="report-grid"><button onClick={exportPdf}><span className="report-icon pdf"><FileText /></span><div><b>Informe PDF</b><small>Abre la versión imprimible para guardar como PDF.</small></div><Download /></button><button onClick={exportHtml}><span className="report-icon html"><FileCode2 /></span><div><b>Informe HTML</b><small>Documento autocontenido para compartir o archivar.</small></div><Download /></button><button onClick={exportPng}><span className="report-icon image"><FileImage /></span><div><b>Imagen PNG</b><small>Captura gráfica del cronograma y sus cápsulas.</small></div><Download /></button><button onClick={exportExcel}><span className="report-icon csv"><FileSpreadsheet /></span><div><b>Libro Excel</b><small>Jerarquía, prioridad, fechas, responsables y avance.</small></div><Download /></button></section>}
    {view === "activity" && <section className="panel project-activity"><header><div><span className="eyebrow">TRAZABILIDAD</span><h3>Actividad del proyecto</h3></div><button className="icon-button" onClick={loadActivity} disabled={activityLoading}><RefreshCw size={16} className={activityLoading ? "spin" : ""} /></button></header>{activityError && <p className="form-error">{activityError}</p>}<div>{activityRows.map((row) => <article key={row.id}><span className={`activity-dot action-${row.action}`} /> <div><b>{row.actor_name}</b> {actionLabels[row.action] || row.action} <strong>{row.entity_title}</strong><small>{format(new Date(row.created_at), "dd MMM yyyy · HH:mm", { locale: es })}</small></div></article>)}{!activityRows.length && !activityLoading && !activityError && <div className="view-empty"><Activity /><b>Sin actividad registrada</b></div>}{activityLoading && <div className="view-empty"><RefreshCw className="spin" /> Cargando actividad…</div>}</div></section>}
    {tasks.some((task) => task.status === "blocked") && view !== "board" && <div className="project-blocked-summary"><AlertTriangle size={16} /><span><b>{tasks.filter((task) => task.status === "blocked").length} tareas bloqueadas.</b> Ábrelas para revisar sus predecesoras y relaciones.</span></div>}
    {selectedTask && <TaskEditor key={selectedTask.id} task={tasks.find((task) => task.id === selectedTask.id) || selectedTask} allTasks={tasks} sections={sections.length ? sections : ["General"]} members={members} canEdit={canEdit} projectStatuses={projectStatuses} projectTaskTypes={projectTaskTypes} onClose={() => setSelectedTask(null)} onUpdated={updateLocalTask} onCreated={createLocalTask} onDeleted={deleteLocalTask} onSelectTask={setSelectedTask} />}
    <ProjectStatusSettings projectId={project.id} options={projectStatuses} open={statusSettingsOpen} onClose={() => setStatusSettingsOpen(false)} onSaved={setProjectStatuses} />
    <ProjectTypeSettings projectId={project.id} options={projectTaskTypes} open={typeSettingsOpen} onClose={() => setTypeSettingsOpen(false)} onSaved={setProjectTaskTypes} />
  </>;
}
