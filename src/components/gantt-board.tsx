"use client";

import {
  AlertTriangle, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, CornerDownRight,
  Columns3, CopyPlus, Link2, Maximize2, Minimize2, Plus, Presentation, StickyNote, Trash2, X,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Person, Task, TaskStatus } from "@/lib/types";
import { defaultProjectStatuses, type ProjectTaskStatus } from "@/lib/task-statuses";
import { defaultProjectTaskTypes, taskTypeLabel, type ProjectTaskType } from "@/lib/task-types";
import { taskDisplayColor, type TaskColorMode } from "@/lib/task-colors";
import { sortTasksByDate, sortTasksManual, taskDepth, taskDisplaySection } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { TaskBadge } from "./status";

type AssignableMember = { user_id: string; full_name: string; email: string };
type DragState = { taskId: string; startX: number; startY: number; width: number; start: Date; due: Date; deltaDays: number; previous: Task[] };
type ColumnKey = "task" | "taskType" | "owner" | "status" | "priority" | "progress" | "startDate" | "dueDate" | "actualDate";
type ColumnResizeState = { column: ColumnKey; startX: number; startWidth: number; min: number; max: number; scale: number };
type AssigneePopoverPosition = { left: number; top?: number; bottom?: number; maxHeight: number; placement: "top" | "bottom" };

const colors = ["#2f7669", "#3778a6", "#7f5aa6", "#c07a32", "#b64e4e", "#68766f"];
const defaultColumnWidths: Record<ColumnKey, number> = { task: 235, taskType: 96, owner: 130, status: 90, priority: 78, progress: 70, startDate: 104, dueDate: 104, actualDate: 104 };
const defaultVisibleColumns: Record<ColumnKey, boolean> = { task: true, taskType: true, owner: true, status: true, priority: true, progress: true, startDate: true, dueDate: true, actualDate: true };
function dateValue(date: Date) { return format(date, "yyyy-MM-dd"); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—"; }
function memberPerson(member: AssignableMember): Person {
  return { id: member.user_id, name: member.full_name || member.email.split("@")[0], initials: initials(member.full_name || member.email), role: "Ingeniero", color: "#476f8f" };
}
const unassigned: Person = { id: "unassigned", name: "Sin asignar", initials: "—", role: "Ingeniero", color: "#98a6a0" };

export function GanttBoard({ initialTasks, projectId, timelineStart, readOnly = false, colorMode = "manual", projectStatuses = defaultProjectStatuses, projectTaskTypes = defaultProjectTaskTypes, taskOrderMode = "date", sectionOrder = [], onTasksChange, onOpenTask }: { initialTasks: Task[]; projectId: string; timelineStart?: string; readOnly?: boolean; colorMode?: TaskColorMode; projectStatuses?: ProjectTaskStatus[]; projectTaskTypes?: ProjectTaskType[]; taskOrderMode?: "date" | "manual"; sectionOrder?: string[]; onTasksChange?: (tasks: Task[]) => void; onOpenTask?: (task: Task) => void }) {
  const projectBase = useMemo(() => timelineStart ? new Date(`${timelineStart}T12:00:00`) : new Date(), [timelineStart]);
  const [items, setItems] = useState<Task[]>(() => initialTasks.map((task) => {
    const start = task.startDate ? new Date(`${task.startDate}T12:00:00`) : addDays(projectBase, task.start - 1);
    const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : addDays(start, Math.max(0, task.duration - 1));
    return { ...task, startDate: dateValue(start), dueDate: dateValue(due), color: task.color || "#2f7669" };
  }));
  const [windowStart, setWindowStart] = useState(() => startOfWeek(projectBase, { weekStartsOn: 1 }));
  const [rangeDays, setRangeDays] = useState(56);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [collapsedParents, setCollapsedParents] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState(defaultColumnWidths);
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hierarchyDrag, setHierarchyDrag] = useState<string | null>(null);
  const [hierarchyTarget, setHierarchyTarget] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"task" | "milestone">("task");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [taskColor, setTaskColor] = useState(colors[0]);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("todo");
  const [taskPriority, setTaskPriority] = useState<1 | 2 | 3>(2);
  const [createAssignees, setCreateAssignees] = useState<string[]>([]);
  const [manualAssignee, setManualAssignee] = useState("");
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [interactionError, setInteractionError] = useState("");
  const [sectionOptions, setSectionOptions] = useState<string[]>(() => {
    const names = Array.from(new Set(initialTasks.map((item) => item.section).filter(Boolean)));
    return names.length ? names : ["General"];
  });
  const [taskSection, setTaskSection] = useState(sectionOptions[0]);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sectionDraft, setSectionDraft] = useState("");
  const [sectionError, setSectionError] = useState("");
  const [sectionSaving, setSectionSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [simpleView, setSimpleView] = useState(false);
  const [assigneeEditorTaskId, setAssigneeEditorTaskId] = useState<string | null>(null);
  const [assigneePopoverPosition, setAssigneePopoverPosition] = useState<AssigneePopoverPosition | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState<"copy" | "delete" | "move" | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const columnVisibilityRef = useRef<HTMLDivElement>(null);
  const assigneeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const columnResizeRef = useRef<ColumnResizeState | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollElementRef = useRef<HTMLElement | null>(null);
  const didMountItemsRef = useRef(false);
  const syncingFromParentRef = useRef(false);

  const timelineDays = useMemo(() => Array.from({ length: rangeDays }, (_, index) => addDays(windowStart, index)), [rangeDays, windowStart]);
  const segmentSize = 7;
  const timelineSegments = useMemo(() => Array.from({ length: Math.ceil(rangeDays / segmentSize) }, (_, index) => {
    const first = timelineDays[index * segmentSize];
    const last = timelineDays[Math.min(timelineDays.length - 1, index * segmentSize + segmentSize - 1)];
    return `${format(first, "d MMM", { locale: es })} – ${format(last, "d MMM", { locale: es })}`;
  }), [rangeDays, segmentSize, timelineDays]);
  const todayKey = dateValue(new Date());
  const todayOffset = differenceInCalendarDays(new Date(), windowStart);
  const orderedItems = useMemo(() => taskOrderMode === "manual" ? sortTasksManual(items) : sortTasksByDate(items), [items, taskOrderMode]);
  const sections = useMemo(() => Array.from(new Set([...sectionOrder, ...sectionOptions, ...items.map((item) => taskDisplaySection(item, items))])), [items, sectionOptions, sectionOrder]);
  const hasChildren = (task: Task) => items.some((item) => item.parentId === task.id);
  const isHiddenByParent = (task: Task) => {
    let parentId = task.parentId; const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (collapsedParents.includes(parentId)) return true;
      visited.add(parentId); parentId = items.find((item) => item.id === parentId)?.parentId;
    }
    return false;
  };
  const allTasksInSection = (section: string) => orderedItems.filter((item) => taskDisplaySection(item, items) === section);
  const tasksInSection = (section: string) => allTasksInSection(section).filter((item) => !isHiddenByParent(item));
  const visible = orderedItems.filter((task) => !collapsed.includes(taskDisplaySection(task, items)) && !isHiddenByParent(task));
  const allVisibleSelected = visible.length > 0 && visible.every((task) => selectedTasks.includes(task.id));
  const activeStatuses = useMemo(() => projectStatuses.filter((item) => item.enabled).sort((left, right) => left.sortOrder - right.sortOrder), [projectStatuses]);
  const statuses = useMemo(() => activeStatuses.map((item) => ({ value: item.status, label: item.label })), [activeStatuses]);

  useEffect(() => {
    if (!activeStatuses.some((item) => item.status === taskStatus)) setTaskStatus(activeStatuses[0]?.status ?? "todo");
  }, [activeStatuses, taskStatus]);

  useEffect(() => {
    if (!columnsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!columnVisibilityRef.current?.contains(event.target as Node)) setColumnsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setColumnsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [columnsOpen]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`orbit-gantt-columns-${projectId}`);
      if (saved) setColumnWidths({ ...columnWidths, ...JSON.parse(saved) });
      const savedVisibility = window.localStorage.getItem(`orbit-gantt-visible-columns-${projectId}`);
      if (savedVisibility) setVisibleColumns({ ...defaultVisibleColumns, ...JSON.parse(savedVisibility), task: true });
    } catch { /* keep defaults */ }
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleColumn = (column: ColumnKey) => {
    if (column === "task") return;
    setVisibleColumns((current) => {
      const next = { ...current, [column]: !current[column], task: true };
      window.localStorage.setItem(`orbit-gantt-visible-columns-${projectId}`, JSON.stringify(next));
      return next;
    });
  };

  const startColumnResize = (event: React.PointerEvent<HTMLButtonElement>, column: ColumnKey, min: number, max: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnResizeRef.current = { column, startX: event.clientX, startWidth: columnWidths[column], min, max, scale: 1 };
  };

  const moveColumnResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = columnResizeRef.current;
    if (!resize) return;
    const width = Math.min(resize.max, Math.max(resize.min, resize.startWidth + (event.clientX - resize.startX) / resize.scale));
    setColumnWidths((current) => ({ ...current, [resize.column]: Math.round(width) }));
  };

  const endColumnResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!columnResizeRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    columnResizeRef.current = null;
    setColumnWidths((current) => {
      window.localStorage.setItem(`orbit-gantt-columns-${projectId}`, JSON.stringify(current));
      return current;
    });
  };

  const resetColumnWidth = (column: ColumnKey) => {
    setColumnWidths((current) => {
      const next = { ...current, [column]: defaultColumnWidths[column] };
      window.localStorage.setItem(`orbit-gantt-columns-${projectId}`, JSON.stringify(next));
      return next;
    });
  };

  const columnResizer = (column: ColumnKey, min: number, max: number) => <button type="button" className="column-resizer" aria-label={`Cambiar ancho de la columna ${column}`} title="Arrastra para cambiar el ancho · doble clic para restablecer" onPointerDown={(event) => startColumnResize(event, column, min, max)} onPointerMove={moveColumnResize} onPointerUp={endColumnResize} onPointerCancel={endColumnResize} onDoubleClick={() => resetColumnWidth(column)} />;

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let active = true;
    const load = async () => {
      const supabase = createClient()!;
      const [sectionResult, memberResult, externalResult] = await Promise.all([
        supabase.from("project_sections").select("name,sort_order").eq("project_id", projectId).order("sort_order"),
        supabase.rpc("get_project_assignable_members", { target_project: projectId }),
        supabase.from("project_external_assignees").select("id,name").eq("project_id", projectId).order("name"),
      ]);
      if (!active) return;
      if (sectionResult.data?.length) {
        const names = sectionResult.data.map((row) => row.name);
        setSectionOptions(names); setTaskSection((current) => names.includes(current) ? current : names[0]);
      }
      if (memberResult.data) setMembers([...(memberResult.data as AssignableMember[]), ...((externalResult.data || []).map((item) => ({ user_id: `external:${item.id}`, full_name: item.name, email: "Responsable del proyecto" })))]);
    };
    load();
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    const listener = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const positionAssigneePopover = (anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const popoverWidth = Math.min(276, window.innerWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - popoverWidth - margin),
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement = spaceBelow >= 310 || spaceBelow >= rect.top ? "bottom" : "top";
    const maxHeight = Math.max(80, (placement === "bottom" ? spaceBelow : rect.top) - gap - margin);
    setAssigneePopoverPosition(placement === "bottom"
      ? { left, top: rect.bottom + gap, maxHeight, placement }
      : { left, bottom: window.innerHeight - rect.top + gap, maxHeight, placement });
  };

  const closeAssigneeEditor = () => {
    setAssigneeEditorTaskId(null);
    setAssigneePopoverPosition(null);
    assigneeAnchorRef.current = null;
  };

  const toggleAssigneeEditor = (event: React.MouseEvent<HTMLButtonElement>, taskId: string) => {
    if (readOnly) return;
    if (assigneeEditorTaskId === taskId) {
      closeAssigneeEditor();
      return;
    }
    assigneeAnchorRef.current = event.currentTarget;
    positionAssigneePopover(event.currentTarget);
    setAssigneeEditorTaskId(taskId);
  };

  useEffect(() => {
    if (!assigneeEditorTaskId) return;
    const updatePosition = () => {
      const anchor = assigneeAnchorRef.current;
      if (!anchor?.isConnected) {
        closeAssigneeEditor();
        return;
      }
      positionAssigneePopover(anchor);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAssigneeEditor();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [assigneeEditorTaskId]);

  useEffect(() => {
    if (!didMountItemsRef.current) {
      didMountItemsRef.current = true;
      return;
    }
    if (syncingFromParentRef.current) {
      syncingFromParentRef.current = false;
      return;
    }
    onTasksChange?.(items);
  }, [items, onTasksChange]);

  useEffect(() => {
    setItems((current) => {
      const normalized = initialTasks.map((task) => {
        const start = task.startDate ? new Date(`${task.startDate}T12:00:00`) : addDays(projectBase, task.start - 1);
        const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : addDays(start, Math.max(0, task.duration - 1));
        return { ...task, startDate: dateValue(start), dueDate: dateValue(due), color: task.color || "#2f7669" };
      });
      const signature = (list: Task[]) => JSON.stringify(list.map((task) => [task.id, task.parentId, task.title, task.section, task.status, task.progress, task.priority, task.startDate, task.dueDate, task.actualCompletionDate, task.color, task.assigneeIds, task.directoryAssigneeIds, task.manualAssignee, task.rollupProgress, task.taskTypeId, task.sortOrder, task.hasPrivateNote]));
      if (signature(current) === signature(normalized)) return current;
      syncingFromParentRef.current = true;
      return normalized;
    });
  }, [initialTasks, projectBase]);

  const openTaskCreator = () => {
    setCreateError(""); setCreateKind("task"); setTaskSection(sections[0] ?? "General");
    setTaskColor(colors[0]); setTaskStatus("todo"); setTaskPriority(2); setCreateAssignees([]); setManualAssignee(""); setCreateOpen(true);
  };

  const addProjectSection = async () => {
    const clean = sectionDraft.trim();
    if (!clean) return;
    const existing = sections.find((section) => section.toLowerCase() === clean.toLowerCase());
    if (existing) { setTaskSection(existing); setSectionDraft(""); setSectionOpen(false); return; }
    if (!hasSupabaseConfig) { setSectionOptions((current) => [...current, clean]); setTaskSection(clean); setSectionDraft(""); setSectionOpen(false); return; }
    setSectionSaving(true); setSectionError("");
    const { error } = await createClient()!.rpc("add_project_section", { target_project: projectId, section_name: clean });
    if (error) { setSectionError(error.code === "PGRST202" ? "Falta aplicar la migración de secciones." : error.message); setSectionSaving(false); return; }
    setSectionOptions((current) => [...current, clean]); setTaskSection(clean); setSectionDraft(""); setSectionOpen(false); setSectionSaving(false);
  };

  const createTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreating(true); setCreateError("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "");
    const rawStart = String(form.get("start_date") || "");
    const rawDue = String(form.get("due_date") || "");
    const startDate = createKind === "milestone" ? rawDue || dateValue(new Date()) : rawStart || dateValue(new Date());
    const dueDate = rawDue || (createKind === "milestone" ? startDate : "");
    if (hasSupabaseConfig) {
      const supabase = createClient()!;
      const payload = {
        target_project: projectId, task_title: title, task_section: taskSection,
        task_start: startDate, task_due: dueDate || null, task_is_milestone: createKind === "milestone",
        task_color: taskColor, task_status: taskStatus,
        target_assignee: null,
        assignee_label: null,
      };
      let creation = await supabase.rpc("create_task_with_details", payload);
      if (creation.error?.message.toLowerCase().includes("jwt issued at future")) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error) creation = await supabase.rpc("create_task_with_details", payload);
      }
      if (creation.error || !creation.data) {
        const problem = creation.error;
        console.error("[Orbit] No se pudo crear la tarea", { code: problem?.code, message: problem?.message, details: problem?.details, hint: problem?.hint });
        const message = problem?.code === "PGRST202"
          ? "Supabase no encuentra create_task_with_details. Aplica la migración 202607140005_interactive_gantt.sql y recarga el esquema."
          : problem?.message.toLowerCase().includes("no tienes permisos")
            ? "Este proyecto está en modo de consulta. Solo su propietario o un colaborador editor puede crear tareas."
            : problem?.message.toLowerCase().includes("jwt issued at future")
              ? "La sesión está desfasada. Cierra sesión, corrige la hora automática del equipo y vuelve a ingresar."
              : problem?.message || "Supabase no devolvió el identificador de la tarea. Revisa la consola y la petición RPC en Network.";
        setCreateError(message); setCreating(false); return;
      }
      const taskId = String(creation.data);
      const registeredIds = createAssignees.filter((id) => !id.startsWith("external:"));
      const directoryIds = createAssignees.filter((id) => id.startsWith("external:")).map((id) => id.replace("external:", ""));
      if (manualAssignee.trim()) {
        const { data: externalId } = await supabase.rpc("remember_external_assignee", { target_project: projectId, assignee_name: manualAssignee.trim() });
        if (externalId) { directoryIds.push(String(externalId)); setMembers((current) => current.some((item) => item.user_id === `external:${externalId}`) ? current : [...current, { user_id: `external:${externalId}`, full_name: manualAssignee.trim(), email: "Responsable del proyecto" }]); }
      }
      const assignment = await supabase.rpc("set_task_assignees", { target_task: taskId, target_users: registeredIds, target_directory_assignees: directoryIds });
      if (assignment.error && assignment.error.code !== "PGRST202") setInteractionError(`La tarea fue creada, pero no se guardó el responsable: ${assignment.error.message}`);
      const selectedMembers = members.filter((member) => createAssignees.includes(member.user_id));
      const selectedOwners = selectedMembers.map(memberPerson);
      if (manualAssignee.trim()) selectedOwners.push({ ...unassigned, id: `manual-${taskId}`, name: manualAssignee.trim(), initials: initials(manualAssignee.trim()) });
      const owner = selectedOwners[0] || unassigned;
      const start = new Date(`${startDate}T12:00:00`);
      const due = dueDate ? new Date(`${dueDate}T12:00:00`) : start;
      setItems((current) => [...current, {
        id: taskId, projectId, title, section: taskSection, owner,
        start: differenceInCalendarDays(start, projectBase) + 1,
        duration: createKind === "milestone" ? 1 : Math.max(1, differenceInCalendarDays(due, start) + 1),
        progress: taskStatus === "done" ? 100 : 0, status: taskStatus, priority: taskPriority,
        due: dueDate ? format(due, "dd MMM", { locale: es }) : "Sin fecha",
        startDate, dueDate, isMilestone: createKind === "milestone", color: taskColor,
        assigneeId: registeredIds[0], assigneeIds: registeredIds, directoryAssigneeIds: directoryIds, manualAssignee: selectedOwners.find((item) => item.id.startsWith("external:") || item.id.startsWith("manual-"))?.name, owners: selectedOwners,
      }]);
      const { error: priorityError } = await supabase.rpc("set_task_priority", { target_task: taskId, next_priority: taskPriority });
      if (priorityError) {
        console.error("[Orbit] La tarea fue creada, pero no se guardó su prioridad", { code: priorityError.code, message: priorityError.message });
        setInteractionError(priorityError.code === "PGRST202"
          ? "La tarea fue creada con prioridad media. Falta aplicar 202607150009_task_priority_external_assignees.sql."
          : `La tarea fue creada, pero Supabase no guardó la prioridad: ${priorityError.message}`);
      }
    }
    setCreating(false); setCreateOpen(false);
  };

  const updatePresentation = async (taskId: string, nextStatus: TaskStatus, nextColor: string) => {
    const previous = items;
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, status: nextStatus, color: nextColor, progress: nextStatus === "done" ? 100 : task.status === "done" ? 0 : task.progress, actualCompletionDate: nextStatus !== "done" && task.status === "done" ? "" : task.actualCompletionDate } : task));
    if (!hasSupabaseConfig || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId)) return;
    const supabase = createClient()!;
    let result = await supabase.rpc("update_task_presentation", { target_task: taskId, next_status: nextStatus, next_color: nextColor });
    if (result.error?.message.toLowerCase().includes("jwt issued at future")) {
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.error) result = await supabase.rpc("update_task_presentation", { target_task: taskId, next_status: nextStatus, next_color: nextColor });
    }
    if (result.error) {
      setItems(previous);
      setInteractionError(result.error.message.toLowerCase().includes("jwt issued at future") ? "No fue posible renovar la sesión. Cierra sesión y vuelve a ingresar." : result.error.message);
    }
  };

  const updateProgress = async (taskId: string, nextProgress: number) => {
    const progress = Math.min(100, Math.max(0, nextProgress));
    const previous = items;
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, progress, status: progress === 100 ? "done" : task.status === "done" ? "progress" : task.status, actualCompletionDate: progress < 100 && task.status === "done" ? "" : task.actualCompletionDate } : task));
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("update_task_progress", { target_task: taskId, next_progress: progress });
    if (error) { setItems(previous); setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607140006_task_management.sql." : error.message); }
  };

  const updatePriority = async (taskId: string, nextPriority: 1 | 2 | 3) => {
    const previous = items;
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, priority: nextPriority } : task));
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("set_task_priority", { target_task: taskId, next_priority: nextPriority });
    if (error) {
      setItems(previous);
      setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607150009_task_priority_external_assignees.sql." : error.message);
    }
  };

  const updateTaskType = async (taskId: string, nextTypeId: string) => {
    const previous = items;
    const type = projectTaskTypes.find((item) => item.id === nextTypeId);
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, taskTypeId: nextTypeId, taskTypeName: type?.name, taskTypeColor: type?.color } : task));
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("set_task_type", { target_task: taskId, next_type: nextTypeId || null });
    if (error) { setItems(previous); setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607200018_flexible_dates_task_types_import.sql." : error.message); }
  };

  const toggleInlineAssignee = async (task: Task, member: AssignableMember) => {
    const previous = items;
    const isDirectory = member.user_id.startsWith("external:");
    const selectedId = isDirectory ? member.user_id.replace("external:", "") : member.user_id;
    let userIds = [...(task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []))];
    let directoryIds = [...(task.directoryAssigneeIds || [])];

    // Older tasks only stored manual_assignee. Recover its directory id before
    // toggling so editing inline never drops a previously assigned contact.
    if (!directoryIds.length && task.manualAssignee) {
      const legacy = members.find((item) => item.user_id.startsWith("external:") && item.full_name.localeCompare(task.manualAssignee || "", undefined, { sensitivity: "accent" }) === 0);
      if (legacy) directoryIds = [legacy.user_id.replace("external:", "")];
    }

    if (isDirectory) directoryIds = directoryIds.includes(selectedId) ? directoryIds.filter((id) => id !== selectedId) : [...directoryIds, selectedId];
    else userIds = userIds.includes(selectedId) ? userIds.filter((id) => id !== selectedId) : [...userIds, selectedId];

    const selectedMembers = members.filter((item) => item.user_id.startsWith("external:")
      ? directoryIds.includes(item.user_id.replace("external:", ""))
      : userIds.includes(item.user_id));
    const owners = selectedMembers.map((item) => item.user_id.startsWith("external:")
      ? { ...memberPerson(item), directoryId: item.user_id.replace("external:", ""), color: "#748a82" }
      : memberPerson(item));
    const firstDirectory = selectedMembers.find((item) => item.user_id.startsWith("external:"));

    setItems((current) => current.map((item) => item.id === task.id ? {
      ...item,
      owners,
      owner: owners[0] || unassigned,
      assigneeIds: userIds,
      assigneeId: userIds[0],
      directoryAssigneeIds: directoryIds,
      manualAssignee: firstDirectory?.full_name,
    } : item));

    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("set_task_assignees", {
      target_task: task.id,
      target_users: userIds,
      target_directory_assignees: directoryIds,
    });
    if (error) {
      setItems(previous);
      setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : error.message);
    }
  };

  const updateInlineDate = async (task: Task, field: "startDate" | "dueDate" | "actualCompletionDate", value: string) => {
    const previous = items;
    setItems((current) => current.map((item) => item.id === task.id ? {
      ...item,
      [field]: value,
      due: field === "dueDate" && value ? format(new Date(`${value}T12:00:00`), "dd MMM", { locale: es }) : item.due,
    } : item));
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("update_task_dates", {
      target_task: task.id,
      task_start: field === "startDate" ? value || null : task.startDate || null,
      task_due: field === "dueDate" ? value || null : task.dueDate || null,
      task_actual: field === "actualCompletionDate" ? value || null : task.actualCompletionDate || null,
    });
    if (error) { setItems(previous); setInteractionError(error.code === "PGRST202" || error.message.toLowerCase().includes("fecha de término") ? "Aplica la migración 202607200018_flexible_dates_task_types_import.sql para editar las fechas libremente." : error.message); }
  };

  const duplicateTask = async (task: Task) => {
    if (readOnly) return;
    let newId = `copy-${Date.now()}`;
    if (hasSupabaseConfig) {
      const { data, error } = await createClient()!.rpc("duplicate_task", { target_task: task.id });
      if (error) { setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607200016_task_delays_actual_dates.sql." : error.message); return; }
      newId = String(data);
    }
    setItems((current) => [...current, { ...task, id: newId, title: `Copia de ${task.title}`, status: "todo", progress: 0, actualCompletionDate: "", rollupProgress: false }]);
  };

  const toggleTaskSelection = (taskId: string) => setSelectedTasks((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]);
  const duplicateSelectedTasks = async () => {
    if (!selectedTasks.length || readOnly) return;
    setBulkBusy("copy"); setInteractionError("");
    const selected = orderedItems.filter((task) => selectedTasks.includes(task.id));
    const idMap = new Map<string, string>();
    if (hasSupabaseConfig) {
      const { data, error } = await createClient()!.rpc("duplicate_tasks", { target_tasks: selectedTasks });
      if (error) { setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607200020_fix_bulk_task_copy_uuid.sql." : error.message); setBulkBusy(null); return; }
      for (const row of data || []) idMap.set(String(row.source_task), String(row.duplicated_task));
    } else selected.forEach((task, index) => idMap.set(task.id, `copy-${Date.now()}-${index}`));
    const maxOrder = Math.max(0, ...items.map((task) => task.sortOrder || 0));
    const copies = selected.map((task, index): Task => ({ ...task, id: idMap.get(task.id)!, parentId: task.parentId ? idMap.get(task.parentId) || task.parentId : undefined, title: `Copia de ${task.title}`, status: "todo", progress: 0, actualCompletionDate: "", rollupProgress: false, sortOrder: maxOrder + (index + 1) * 10 }));
    setItems((current) => [...current, ...copies]); setSelectedTasks([]); setSelectionMode(false); setBulkBusy(null);
  };

  const deleteSelectedTasks = async () => {
    if (!selectedTasks.length || readOnly) return;
    const selectedSet = new Set(selectedTasks);
    const roots = items.filter((task) => selectedSet.has(task.id) && !(() => {
      let parentId = task.parentId; const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) { if (selectedSet.has(parentId)) return true; visited.add(parentId); parentId = items.find((item) => item.id === parentId)?.parentId; }
      return false;
    })());
    const descendantIds = new Set<string>(); roots.forEach((task) => branchIds(task.id).forEach((id) => descendantIds.add(id)));
    const affected = descendantIds.size;
    if (!window.confirm(`¿Eliminar ${affected} ${affected === 1 ? "tarea" : "tareas"}? Esta acción también elimina las subtareas incluidas y no se puede deshacer.`)) return;
    setBulkBusy("delete"); setInteractionError("");
    if (hasSupabaseConfig) {
      for (const task of roots) {
        const { error } = await createClient()!.rpc("delete_task", { target_task: task.id });
        if (error) { setInteractionError(error.message); setBulkBusy(null); return; }
      }
    }
    setItems((current) => current.filter((task) => !descendantIds.has(task.id)));
    setSelectedTasks([]); setSelectionMode(false); setBulkBusy(null);
  };

  const branchIds = (rootId: string) => {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      items.forEach((task) => {
        if (task.parentId && result.has(task.parentId) && !result.has(task.id)) { result.add(task.id); changed = true; }
      });
    }
    return result;
  };

  const selectedRootTasks = () => {
    const selectedSet = new Set(selectedTasks);
    return items.filter((task) => selectedSet.has(task.id) && !(() => {
      let parentId = task.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (selectedSet.has(parentId)) return true;
        visited.add(parentId);
        parentId = items.find((item) => item.id === parentId)?.parentId;
      }
      return false;
    })());
  };

  const moveSelectedHierarchy = async (parentId: string | null, section: string) => {
    const roots = selectedRootTasks();
    if (!roots.length) return;
    const selectedBranches = new Set<string>();
    roots.forEach((root) => branchIds(root.id).forEach((id) => selectedBranches.add(id)));
    const parent = parentId ? items.find((task) => task.id === parentId) : undefined;
    if (parentId && !parent) { setInteractionError("La tarea de destino ya no está disponible."); return; }
    if (parent && selectedBranches.has(parent.id)) { setInteractionError("No puedes mover la selección dentro de una de sus propias ramas."); return; }
    if (parent) {
      const exceedsDepth = roots.some((root) => {
        const branch = branchIds(root.id);
        const subtreeDepth = Math.max(0, ...Array.from(branch).map((id) => taskDepth(items.find((task) => task.id === id)!, items) - taskDepth(root, items)));
        return taskDepth(parent, items) + 1 + subtreeDepth > 3;
      });
      if (exceedsDepth) { setInteractionError("El destino no tiene espacio para toda la jerarquía seleccionada."); return; }
    }

    const nextSection = parent ? taskDisplaySection(parent, items) : section || "General";
    const previous = items;
    setBulkBusy("move");
    setInteractionError("");
    setItems((current) => current.map((task) => selectedBranches.has(task.id) ? {
      ...task,
      parentId: roots.some((root) => root.id === task.id) ? parent?.id : task.parentId,
      section: nextSection,
    } : task));
    if (parent) setCollapsedParents((current) => current.filter((id) => id !== parent.id));

    if (hasSupabaseConfig) {
      const { error } = await createClient()!.rpc("move_tasks_in_hierarchy", {
        target_tasks: selectedTasks,
        new_parent: parent?.id || null,
        target_section: nextSection,
      });
      if (error) {
        setItems(previous);
        const message = error.code === "PGRST202" ? "Falta aplicar la migración 202607230023_bulk_hierarchy_move.sql." : error.message;
        setInteractionError(message);
        setBulkBusy(null);
        return;
      }
    }
    setBulkBusy(null);
  };

  const moveHierarchy = async (taskId: string, parentId: string | null, section: string) => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
      autoScrollSpeedRef.current = 0;
      autoScrollElementRef.current = null;
    }
    const moving = items.find((task) => task.id === taskId);
    const parent = parentId ? items.find((task) => task.id === parentId) : undefined;
    if (!moving || taskId === parentId) return;
    const branch = branchIds(taskId);
    if (parentId && branch.has(parentId)) { setInteractionError("No puedes mover una tarea dentro de su propia rama."); return; }
    const subtreeDepth = Math.max(0, ...Array.from(branch).map((id) => taskDepth(items.find((task) => task.id === id)!, items) - taskDepth(moving, items)));
    if (parent && taskDepth(parent, items) + 1 + subtreeDepth > 3) { setInteractionError("El movimiento superaría el límite de jerarquía."); return; }
    const nextSection = parent ? taskDisplaySection(parent, items) : section;
    const previous = items;
    setItems((current) => current.map((task) => branch.has(task.id) ? { ...task, parentId: task.id === taskId ? parentId || undefined : task.parentId, section: nextSection } : task));
    setCollapsedParents((current) => parentId ? current.filter((id) => id !== parentId) : current);
    setHierarchyDrag(null); setHierarchyTarget(null);
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("move_task_in_hierarchy", { target_task: taskId, new_parent: parentId, target_section: nextSection });
    if (error) {
      setItems(previous);
      setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607230023_bulk_hierarchy_move.sql." : error.message);
    }
  };

  const stopDragAutoScroll = () => {
    autoScrollSpeedRef.current = 0;
    autoScrollElementRef.current = null;
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const runDragAutoScroll = () => {
    const target = autoScrollElementRef.current;
    const speed = autoScrollSpeedRef.current;
    if (!target || !speed) { stopDragAutoScroll(); return; }
    target.scrollTop += speed;
    autoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
  };

  const updateDragAutoScroll = (clientY: number) => {
    const fullscreenShell = document.fullscreenElement === shellRef.current ? shellRef.current : null;
    const target = fullscreenShell || document.scrollingElement as HTMLElement | null;
    if (!target) return;
    const bounds = fullscreenShell?.getBoundingClientRect();
    const top = bounds?.top ?? 0;
    const bottom = bounds?.bottom ?? window.innerHeight;
    const edge = Math.min(110, Math.max(70, (bottom - top) * 0.13));
    let speed = 0;
    if (clientY < top + edge) speed = -Math.max(3, Math.round((top + edge - clientY) / edge * 18));
    else if (clientY > bottom - edge) speed = Math.max(3, Math.round((clientY - (bottom - edge)) / edge * 18));
    if (!speed) { stopDragAutoScroll(); return; }
    autoScrollElementRef.current = target;
    autoScrollSpeedRef.current = speed;
    if (autoScrollFrameRef.current === null) autoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
  };

  const startHierarchyDrag = (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
    if (readOnly || bulkBusy === "move" || (selectionMode && !selectedTasks.includes(taskId))) {
      event.preventDefault();
      return;
    }
    setHierarchyDrag(taskId); setHierarchyTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    if (selectionMode && selectedTasks.length > 1) {
      const ghost = document.createElement("div");
      ghost.className = "gantt-multi-drag-ghost";
      ghost.textContent = `${selectedTasks.length} tareas`;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 18, 18);
      window.requestAnimationFrame(() => ghost.remove());
    }
  };

  const dropOnTask = async (event: React.DragEvent<HTMLDivElement>, parentId: string) => {
    event.preventDefault(); event.stopPropagation();
    const taskId = hierarchyDrag || event.dataTransfer.getData("text/plain");
    const parent = items.find((task) => task.id === parentId);
    if (!taskId || !parent) return;
    if (selectionMode && selectedTasks.includes(taskId)) await moveSelectedHierarchy(parentId, taskDisplaySection(parent, items));
    else await moveHierarchy(taskId, parentId, taskDisplaySection(parent, items));
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, task: Task) => {
    if (readOnly || selectionMode || !task.startDate) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const start = new Date(`${task.startDate}T12:00:00`);
    const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : start;
    dragRef.current = { taskId: task.id, startX: event.clientX, startY: event.clientY, width: event.currentTarget.parentElement?.getBoundingClientRect().width || 1, start, due, deltaDays: 0, previous: items };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    if (Math.abs(event.clientY - drag.startY) > 16) {
      updateDragAutoScroll(event.clientY);
      setHierarchyDrag(drag.taskId);
      const underPointer = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const taskTarget = underPointer?.closest<HTMLElement>("[data-task-drop]")?.dataset.taskDrop;
      const sectionTarget = underPointer?.closest<HTMLElement>("[data-section-drop]")?.dataset.sectionDrop;
      setHierarchyTarget(taskTarget && taskTarget !== drag.taskId ? taskTarget : sectionTarget ? `section:${sectionTarget}` : null);
      const originalStart = dateValue(drag.start); const originalDue = dateValue(drag.due);
      setItems((current) => current.map((task) => task.id === drag.taskId ? { ...task, startDate: originalStart, dueDate: originalDue, due: format(drag.due, "dd MMM", { locale: es }) } : task));
      return;
    }
    const delta = Math.round((event.clientX - drag.startX) / drag.width * rangeDays);
    drag.deltaDays = delta;
    const start = addDays(drag.start, delta); const due = addDays(drag.due, delta);
    setItems((current) => current.map((task) => task.id === drag.taskId ? { ...task, startDate: dateValue(start), dueDate: dateValue(due), due: format(due, "dd MMM", { locale: es }) } : task));
  };
  const endDrag = async (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    stopDragAutoScroll();
    event.currentTarget.releasePointerCapture(event.pointerId); dragRef.current = null;
    if (Math.abs(event.clientY - drag.startY) > 16) {
      const underPointer = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const taskTarget = underPointer?.closest<HTMLElement>("[data-task-drop]")?.dataset.taskDrop;
      const sectionTarget = underPointer?.closest<HTMLElement>("[data-section-drop]")?.dataset.sectionDrop;
      if (taskTarget && taskTarget !== drag.taskId) await moveHierarchy(drag.taskId, taskTarget, items.find((task) => task.id === taskTarget)?.section || "General");
      else if (sectionTarget) await moveHierarchy(drag.taskId, null, sectionTarget);
      else { setHierarchyDrag(null); setHierarchyTarget(null); }
      return;
    }
    const startDate = dateValue(addDays(drag.start, drag.deltaDays));
    const dueDate = dateValue(addDays(drag.due, drag.deltaDays));
    if (drag.deltaDays === 0) { const selected = items.find((item) => item.id === drag.taskId); if (selected) await openTask(selected); return; }
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("update_task_schedule", { target_task: drag.taskId, task_start: startDate, task_due: dueDate });
    if (error) { setItems(drag.previous); setInteractionError(error.message); }
  };

  const toggleFullscreen = async () => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen(); else await shellRef.current.requestFullscreen();
  };
  const openTask = async (task: Task) => {
    if (document.fullscreenElement === shellRef.current) await document.exitFullscreen();
    onOpenTask?.(task);
  };
  const navigateWheel = (event: React.WheelEvent) => {
    if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const delta = event.deltaX || event.deltaY;
    setWindowStart((current) => addDays(current, Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 35))));
  };
  const taskOffset = (task: Task) => task.startDate ? differenceInCalendarDays(new Date(`${task.startDate}T12:00:00`), windowStart) : task.start - 1;
  const taskWidth = (task: Task) => task.isMilestone ? 1 : task.startDate && task.dueDate ? Math.max(1, differenceInCalendarDays(new Date(`${task.dueDate}T12:00:00`), new Date(`${task.startDate}T12:00:00`)) + 1) : task.duration;
  const actualDelayOffset = (task: Task) => task.dueDate ? differenceInCalendarDays(new Date(`${task.dueDate}T12:00:00`), windowStart) + 1 : 0;
  const actualDelayWidth = (task: Task) => task.dueDate && task.actualCompletionDate ? Math.max(0, differenceInCalendarDays(new Date(`${task.actualCompletionDate}T12:00:00`), new Date(`${task.dueDate}T12:00:00`))) : 0;
  const dayLabelEvery = rangeDays <= 30 ? 1 : rangeDays <= 60 ? 2 : rangeDays <= 90 ? 3 : 7;
  const visibleColumnOrder: ColumnKey[] = ["task", "taskType", "owner", "status", "priority", "progress", "startDate", "dueDate", "actualDate"];
  const gridTemplateColumns = `${visibleColumnOrder.filter((column) => visibleColumns[column]).map((column) => `${columnWidths[column]}px`).join(" ")} minmax(565px, 1fr)`;
  const informationWidth = visibleColumnOrder.filter((column) => visibleColumns[column]).reduce((sum, column) => sum + columnWidths[column], 0);
  const gridStyle = { gridTemplateColumns } as React.CSSProperties;
  const prettyDate = (value?: string) => value ? format(new Date(`${value}T12:00:00`), "dd MMM yy", { locale: es }) : "Sin fecha";
  const columnOptions: { key: ColumnKey; label: string }[] = [
    { key: "taskType", label: "Tipo de tarea" }, { key: "owner", label: "Responsable" }, { key: "status", label: "Estado" }, { key: "priority", label: "Prioridad" },
    { key: "progress", label: "Avance" }, { key: "startDate", label: "Fecha de inicio" }, { key: "dueDate", label: "Fecha de fin" }, { key: "actualDate", label: "Fecha real" },
  ];
  const assigneeEditorTask = assigneeEditorTaskId ? items.find((task) => task.id === assigneeEditorTaskId) : undefined;
  const assigneeEditorUserIds = assigneeEditorTask?.assigneeIds || (assigneeEditorTask?.assigneeId ? [assigneeEditorTask.assigneeId] : []);
  const assigneeEditorDirectoryIds = assigneeEditorTask?.directoryAssigneeIds || [];
  useEffect(() => () => {
    if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
  }, []);

  return (
    <div className={`gantt-shell ${readOnly ? "gantt-readonly" : ""} ${selectionMode ? "gantt-selection-mode" : ""}`} ref={shellRef} onDragOver={(event) => { if (hierarchyDrag) updateDragAutoScroll(event.clientY); }}>
      <div className="gantt-toolbar">
        <div className="gantt-date-controls"><button className="icon-button period-button" onClick={() => setWindowStart((date) => addDays(date, -Math.ceil(rangeDays / 2)))} aria-label="Periodo anterior"><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setWindowStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoy</button><button className="icon-button period-button" onClick={() => setWindowStart((date) => addDays(date, Math.ceil(rangeDays / 2)))} aria-label="Periodo siguiente"><ChevronRight size={17} /></button><label className="range-select"><CalendarRange size={15} /><select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={28}>4 semanas</option><option value={56}>8 semanas</option><option value={84}>12 semanas</option><option value={182}>26 semanas</option></select></label></div>
        <div className="gantt-toolbar-actions">{!simpleView && <><span className="wheel-hint">Shift + rueda para navegar</span><div className="column-visibility" ref={columnVisibilityRef}><button type="button" className={`button secondary small columns-button ${columnsOpen ? "active" : ""}`} onClick={() => setColumnsOpen((current) => !current)} aria-label="Mostrar u ocultar columnas" aria-expanded={columnsOpen}><Columns3 size={15} /> Columnas</button>{columnsOpen && <div className="column-visibility-menu"><header><b>Columnas visibles</b><span>Personaliza esta vista</span></header>{columnOptions.map((option) => <label key={option.key}><input type="checkbox" checked={visibleColumns[option.key]} onChange={() => toggleColumn(option.key)} /><span>{option.label}</span><i /></label>)}</div>}</div></>}<button className={`button secondary small simple-view-button ${simpleView ? "active" : ""}`} onClick={() => setSimpleView((current) => !current)}><Presentation size={15} />{simpleView ? "Vista completa" : "Vista simple"}</button>{!simpleView && !readOnly && <><button className={`button secondary small selection-button ${selectionMode ? "active" : ""}`} onClick={() => { setSelectionMode((current) => !current); setSelectedTasks([]); }}><Check size={15} /> {selectionMode ? "Cancelar" : "Seleccionar"}</button><button className="button secondary small section-button" onClick={() => { setSectionError(""); setSectionOpen(true); }}><Plus size={15} /> Sección</button><button className="button primary small" onClick={openTaskCreator}><Plus size={16} /> Agregar tarea/hito</button></>}<button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></div>
      </div>
      {interactionError && <div className="gantt-message"><AlertTriangle size={14} />{interactionError}<button onClick={() => setInteractionError("")}><X size={14} /></button></div>}
      {selectionMode && <div className="gantt-selection-bar"><span><Check size={15} /><b>{selectedTasks.length}</b> {selectedTasks.length === 1 ? "tarea seleccionada" : "tareas seleccionadas"}{selectedTasks.length > 0 && <small>Arrastra cualquiera de las seleccionadas para mover el conjunto</small>}</span><div><button className="button secondary small" onClick={() => setSelectedTasks(allVisibleSelected ? [] : visible.map((task) => task.id))}>{allVisibleSelected ? "Limpiar" : "Seleccionar visibles"}</button><button className="button danger-outline small" onClick={deleteSelectedTasks} disabled={!selectedTasks.length || bulkBusy !== null}><Trash2 size={14} />{bulkBusy === "delete" ? "Eliminando…" : "Eliminar"}</button><button className="button primary small" onClick={duplicateSelectedTasks} disabled={!selectedTasks.length || bulkBusy !== null}><CopyPlus size={14} />{bulkBusy === "copy" ? "Copiando…" : "Copiar"}</button></div></div>}
      {simpleView && <div className="gantt-simple-scroll" onWheel={navigateWheel}>
        <div className="gantt-simple-stage" style={{ "--day-size": `${100 / rangeDays}%` } as React.CSSProperties}>
          <div className="gantt-simple-head">
            <div><span>CRONOGRAMA</span><b>Vista de presentación</b></div>
            <div className="gantt-simple-calendar">
              <div className="gantt-weeks" style={{ gridTemplateColumns: `repeat(${timelineSegments.length}, 1fr)` }}>{timelineSegments.map((segment, index) => <span key={`${segment}-${index}`}>{segment}</span>)}</div>
              <div className="gantt-days" style={{ gridTemplateColumns: `repeat(${rangeDays}, 1fr)` }}>{timelineDays.map((day, index) => <span className={dateValue(day) === todayKey ? "today" : ""} key={day.toISOString()}>{index % dayLabelEvery === 0 ? format(day, "d") : ""}</span>)}</div>
            </div>
          </div>
          {sections.filter((section) => allTasksInSection(section).length > 0).map((section) => <section className="gantt-simple-section" key={section}>
            <header><b>{section}</b><span>{allTasksInSection(section).length} actividades</span></header>
            {allTasksInSection(section).map((task) => {
              const depth = taskDepth(task, items);
              const offset = taskOffset(task);
              const width = taskWidth(task);
              const inRange = offset + width > 0 && offset < rangeDays;
              const visibleStart = Math.max(0, offset);
              const clippedStart = Math.max(0, -offset);
              const visibleWidth = Math.max(1, Math.min(rangeDays - visibleStart, width - clippedStart));
              return <div className={`gantt-simple-row depth-${depth}`} key={task.id}>
                <div className="gantt-simple-copy" style={{ paddingLeft: `${15 + depth * 20}px` }}>
                  {depth > 0 ? <CornerDownRight size={13} /> : <i style={{ background: taskDisplayColor(task, colorMode) }} />}
                  <span><b>{task.title}</b><small>{task.owner.name} · {task.progress}%</small></span>
                </div>
                <div className="gantt-simple-track">
                  {inRange && <i className={task.isMilestone ? "milestone" : ""} style={{ left: `${visibleStart / rangeDays * 100}%`, width: task.isMilestone ? "14px" : `${visibleWidth / rangeDays * 100}%`, background: taskDisplayColor(task, colorMode) }}><em style={{ width: `${task.progress}%` }} /></i>}
                </div>
              </div>;
            })}
          </section>)}
          {!items.length && <div className="gantt-empty"><Check size={18} /><b>Aún no hay tareas</b><span>Agrega planificación para preparar esta vista de presentación.</span></div>}
        </div>
      </div>}
      {!simpleView && <div className="gantt-desktop" style={{ "--day-size": `${100 / rangeDays}%`, "--segment-count": timelineSegments.length, minWidth: `${informationWidth + 565}px` } as React.CSSProperties} onWheel={navigateWheel}>
        <div className="gantt-grid gantt-header-row" style={gridStyle}><div className="gantt-task-head">TAREA{columnResizer("task", 180, 430)}</div>{visibleColumns.taskType && <div className="gantt-type-head">TIPO{columnResizer("taskType", 78, 180)}</div>}{visibleColumns.owner && <div className="gantt-owner-head">RESPONSABLES{columnResizer("owner", 90, 260)}</div>}{visibleColumns.status && <div className="gantt-status-head">ESTADO{columnResizer("status", 75, 180)}</div>}{visibleColumns.priority && <div className="gantt-priority-head">PRIORIDAD{columnResizer("priority", 65, 140)}</div>}{visibleColumns.progress && <div className="gantt-progress-head">AVANCE{columnResizer("progress", 65, 150)}</div>}{visibleColumns.startDate && <div className="gantt-date-head">INICIO{columnResizer("startDate", 88, 170)}</div>}{visibleColumns.dueDate && <div className="gantt-date-head">FIN{columnResizer("dueDate", 88, 170)}</div>}{visibleColumns.actualDate && <div className="gantt-date-head actual">REAL{columnResizer("actualDate", 88, 170)}</div>}<div className="gantt-timeline-head"><div className="gantt-weeks" style={{ gridTemplateColumns: `repeat(${timelineSegments.length}, 1fr)` }}>{timelineSegments.map((segment, index) => <span key={`${segment}-${index}`}>{segment}</span>)}</div><div className="gantt-days" style={{ gridTemplateColumns: `repeat(${rangeDays}, 1fr)` }}>{timelineDays.map((day, index) => <span className={dateValue(day) === todayKey ? "today" : ""} key={day.toISOString()}>{index % dayLabelEvery === 0 ? format(day, "d") : ""}</span>)}</div></div></div>
        <div className="gantt-body">
          {todayOffset >= 0 && todayOffset < rangeDays && <div className="today-line" style={{ left: `calc(${informationWidth}px + (100% - ${informationWidth}px) * ${todayOffset / rangeDays})` }} />}
          {sections.map((section) => (
            <div key={section} className="gantt-section-wrap">
              <button data-section-drop={section} className={`gantt-section ${hierarchyDrag ? "hierarchy-drop-section" : ""} ${hierarchyTarget === `section:${section}` ? "drop-active" : ""}`} onClick={() => setCollapsed((state) => state.includes(section) ? state.filter((name) => name !== section) : [...state, section])} onDragOver={(event) => { if (!hierarchyDrag) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setHierarchyTarget(`section:${section}`); }} onDragLeave={() => setHierarchyTarget((current) => current === `section:${section}` ? null : current)} onDrop={async (event) => { event.preventDefault(); event.stopPropagation(); const taskId = hierarchyDrag || event.dataTransfer.getData("text/plain"); if (!taskId) return; if (selectionMode && selectedTasks.includes(taskId)) await moveSelectedHierarchy(null, section); else await moveHierarchy(taskId, null, section); }}>
                {collapsed.includes(section) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <b>{section}</b><span>{hierarchyDrag ? "Soltar como principal" : allTasksInSection(section).length}</span>
              </button>
              {!collapsed.includes(section) && tasksInSection(section).map((task) => {
                const taskHasChildren = hasChildren(task);
                const depth = taskDepth(task, items);
                const priorityLabel = task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media";
                const statusColor = projectStatuses.find((item) => item.status === task.status)?.color || "#68766f";
                const taskOwners = task.owners?.length ? task.owners : [task.owner];
                const scheduleInvalid = Boolean(task.startDate && task.dueDate && task.dueDate < task.startDate);
                const selectedType = projectTaskTypes.find((item) => item.id === task.taskTypeId);
                return <div data-task-drop={task.id} className={`gantt-grid gantt-task-row ${scheduleInvalid ? "schedule-invalid" : ""} ${hierarchyTarget === task.id ? "hierarchy-drop-target" : ""} ${hierarchyDrag === task.id ? "hierarchy-dragging" : ""} ${hierarchyDrag && selectionMode && selectedTasks.includes(task.id) ? "hierarchy-selection-dragging" : ""} ${assigneeEditorTaskId === task.id ? "assignee-row-editing" : ""}`} key={task.id} style={gridStyle} onDragOver={(event) => { if (!hierarchyDrag || hierarchyDrag === task.id) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setHierarchyTarget(task.id); }} onDragLeave={() => setHierarchyTarget((current) => current === task.id ? null : current)} onDrop={(event) => dropOnTask(event, task.id)}>
                  <div className={`gantt-task-name task-depth-${depth}`} draggable={!readOnly && (!selectionMode || selectedTasks.includes(task.id)) && bulkBusy !== "move"} onDragStart={(event) => startHierarchyDrag(event, task.id)} onDragEnd={() => { stopDragAutoScroll(); setHierarchyDrag(null); setHierarchyTarget(null); }} title={selectionMode ? selectedTasks.includes(task.id) ? "Arrastra para mover todas las tareas seleccionadas" : "Selecciona esta tarea para incluirla" : readOnly ? undefined : "Arrastra para anidarla o moverla a una sección"}>
                    {selectionMode ? <button className={`task-selection-check ${selectedTasks.includes(task.id) ? "selected" : ""}`} onClick={() => toggleTaskSelection(task.id)} title="Seleccionar tarea">{selectedTasks.includes(task.id) && <Check size={12} />}</button> : <button className={`tiny-check ${task.status === "done" ? "checked" : ""}`} disabled={readOnly} onClick={() => updatePresentation(task.id, task.status === "done" ? "todo" : "done", task.color || colors[0])} title={readOnly ? "Estado visible en modo de consulta" : "Marcar como completada"}>{task.status === "done" && <Check size={12} />}</button>}
                    <span className="task-tree-control">{taskHasChildren ? <button type="button" className={`hierarchy-toggle ${depth > 0 ? "hierarchy-branch" : "hierarchy-root"} ${collapsedParents.includes(task.id) ? "collapsed" : ""}`} onClick={() => setCollapsedParents((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} title={collapsedParents.includes(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"} aria-label={collapsedParents.includes(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"}>{depth > 0 ? <CornerDownRight size={13} /> : <span className="root-chevron" />}</button> : depth > 0 ? <CornerDownRight className="subtask-arrow" size={13} /> : <span className="hierarchy-spacer" />}</span>
                    <span><span className="task-title-line"><button type="button" className="task-open-button" onClick={() => openTask(task)}>{task.title}</button>{task.hasPrivateNote && <StickyNote className="task-note-marker" size={11} aria-label="Tienes apuntes privados" />}</span>{task.isMilestone && <small>Hito</small>}</span>
                    {!readOnly && !selectionMode && <button type="button" className="task-duplicate-button" onClick={() => duplicateTask(task)} title="Duplicar tarea"><CopyPlus size={13} /></button>}
                    {!readOnly && colorMode === "manual" && <input className="task-color-input" type="color" value={task.color || colors[0]} onChange={(event) => setItems((current) => current.map((item) => item.id === task.id ? { ...item, color: event.target.value } : item))} onBlur={(event) => updatePresentation(task.id, task.status, event.target.value)} title="Color de la tarea" />}
                  </div>
                  {visibleColumns.taskType && <div className="gantt-task-type" style={{ "--task-type-color": selectedType?.color || task.taskTypeColor || "#6b7d75" } as React.CSSProperties}>{readOnly || !projectTaskTypes.length ? <span><i />{selectedType?.name || task.taskTypeName || taskTypeLabel(task.taskTypeId, projectTaskTypes, task.isMilestone)}</span> : <select value={task.taskTypeId || ""} onChange={(event) => updateTaskType(task.id, event.target.value)} aria-label={`Tipo de ${task.title}`}><option value="">Sin tipo</option>{projectTaskTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select>}</div>}
                  {visibleColumns.owner && <div className={`gantt-owner ${assigneeEditorTaskId === task.id ? "editing" : ""}`}>
                    <button type="button" className="gantt-owner-summary" onClick={(event) => toggleAssigneeEditor(event, task.id)} title={readOnly ? taskOwners.map((owner) => owner.name).join(", ") : "Editar responsables aquí"} aria-expanded={assigneeEditorTaskId === task.id}><span className="mini-owner-stack">{taskOwners.slice(0, 2).map((owner) => <Avatar person={owner} size="sm" key={owner.id} />)}</span><span>{taskOwners.map((owner) => owner.name).join(", ") || "Sin asignar"}</span>{taskOwners.length > 2 && <b>+{taskOwners.length - 2}</b>}</button>
                  </div>}
                  {visibleColumns.status && <div className="gantt-status status-tinted" style={{ "--status-cell-color": statusColor } as React.CSSProperties}>{readOnly ? <TaskBadge status={task.status} label={projectStatuses.find((item) => item.status === task.status)?.label} color={statusColor} /> : <select value={task.status} onChange={(event) => updatePresentation(task.id, event.target.value as TaskStatus, task.color || colors[0])}>{statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select>}</div>}
                  {visibleColumns.priority && <div className="gantt-priority">{readOnly ? <span className={`priority-value priority-${priorityLabel.toLowerCase()}`}>{priorityLabel}</span> : <select className={`priority-select priority-${priorityLabel.toLowerCase()}`} value={task.priority || 2} onChange={(event) => updatePriority(task.id, Number(event.target.value) as 1 | 2 | 3)} aria-label={`Prioridad de ${task.title}`}><option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option></select>}</div>}
                  {visibleColumns.progress && <div className="gantt-progress-cell" title={task.rollupProgress ? "Calculado desde subtareas" : undefined}>{readOnly || task.rollupProgress ? <div className="gantt-progress-read"><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><b>{task.progress}%</b></div> : <label className="gantt-progress-control"><span>{task.progress}%</span><input type="range" min="0" max="100" step="5" value={task.progress} onChange={(event) => setItems((current) => current.map((item) => item.id === task.id ? { ...item, progress: Number(event.target.value) } : item))} onPointerUp={(event) => updateProgress(task.id, Number(event.currentTarget.value))} onKeyUp={(event) => updateProgress(task.id, Number(event.currentTarget.value))} onBlur={(event) => updateProgress(task.id, Number(event.currentTarget.value))} aria-label={`Avance de ${task.title}`} /></label>}</div>}
                  {visibleColumns.startDate && <div className={`gantt-date-cell ${scheduleInvalid ? "schedule-invalid-cell" : ""}`} title={scheduleInvalid ? "El inicio es posterior al fin. Puedes seguir editando." : undefined}>{readOnly ? prettyDate(task.startDate) : <input type="date" value={task.startDate || ""} onChange={(event) => updateInlineDate(task, "startDate", event.target.value)} aria-label={`Inicio de ${task.title}`} />}</div>}
                  {visibleColumns.dueDate && <div className={`gantt-date-cell ${task.overdue ? "overdue" : ""} ${scheduleInvalid ? "schedule-invalid-cell" : ""}`} title={scheduleInvalid ? "El fin es anterior al inicio. Puedes seguir editando." : undefined}>{readOnly ? prettyDate(task.dueDate) : <input type="date" value={task.dueDate || ""} onChange={(event) => updateInlineDate(task, "dueDate", event.target.value)} aria-label={`Fin de ${task.title}`} />}</div>}
                  {visibleColumns.actualDate && <div className={`gantt-date-cell actual ${task.actualCompletionDate && task.dueDate && task.actualCompletionDate > task.dueDate ? "late" : ""}`}>{readOnly ? prettyDate(task.actualCompletionDate) : <input type="date" value={task.actualCompletionDate || ""} onChange={(event) => updateInlineDate(task, "actualCompletionDate", event.target.value)} aria-label={`Fecha real de ${task.title}`} />}</div>}
                  <div className="gantt-timeline">{actualDelayWidth(task) > 0 && <span className="gantt-actual-delay" style={{ left: `${actualDelayOffset(task) / rangeDays * 100}%`, width: `${actualDelayWidth(task) / rangeDays * 100}%` }} title={`${actualDelayWidth(task)} días de atraso real`} />}<div className={`gantt-bar bar-${task.status} ${task.isMilestone ? "gantt-milestone" : ""} ${dragRef.current?.taskId === task.id ? "dragging" : ""}`} style={{ left: `${taskOffset(task) / rangeDays * 100}%`, width: task.isMilestone ? "18px" : `${taskWidth(task) / rangeDays * 100}%`, "--task-color": taskDisplayColor(task, colorMode) } as React.CSSProperties} title={`${task.title} · clic para abrir · arrastra para cambiar fechas`} onPointerDown={(event) => startDrag(event, task)} onPointerMove={moveDrag} onPointerUp={endDrag}><i style={{ width: `${task.progress}%` }} /><span>{task.isMilestone ? "" : task.progress > 0 ? `${task.progress}%` : ""}</span>{task.status === "blocked" && <AlertTriangle size={13} />}</div></div>
                </div>;
              })}
            </div>
          ))}
          {!items.length && <div className="gantt-empty"><Check size={18} /><b>Aún no hay tareas</b><span>{readOnly ? "Este proyecto todavía no tiene planificación." : "Agrega una tarea o hito dentro de cualquiera de las secciones."}</span></div>}
        </div>
      </div>}

      {!simpleView && <div className="gantt-mobile">
        <div className="mobile-timeline-key"><span><i className="key-done" />Completada</span><span><i className="key-progress" />En curso</span><span><i className="key-blocked" />Bloqueada</span></div>
        {visible.map((task) => {
          const taskHasChildren = hasChildren(task);
          const depth = taskDepth(task, items);
          return <article className={`mobile-task-card mobile-depth-${depth}`} key={task.id} style={{ borderLeftColor: taskDisplayColor(task, colorMode) }}>
            <div>{selectionMode ? <button className={`task-selection-check ${selectedTasks.includes(task.id) ? "selected" : ""}`} onClick={() => toggleTaskSelection(task.id)} title="Seleccionar tarea">{selectedTasks.includes(task.id) && <Check size={12} />}</button> : <button className={`tiny-check ${task.status === "done" ? "checked" : ""}`} disabled={readOnly} onClick={() => updatePresentation(task.id, task.status === "done" ? "todo" : "done", task.color || colors[0])}>{task.status === "done" && <Check size={12} />}</button>}<span className="task-tree-control">{taskHasChildren ? <button type="button" className={`hierarchy-toggle ${depth > 0 ? "hierarchy-branch" : "hierarchy-root"} ${collapsedParents.includes(task.id) ? "collapsed" : ""}`} onClick={() => setCollapsedParents((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])}>{depth > 0 ? <CornerDownRight size={13} /> : <span className="root-chevron" />}</button> : depth > 0 ? <CornerDownRight className="subtask-arrow" size={13} /> : <span className="hierarchy-spacer" />}</span><span><span className="task-title-line"><button type="button" className="task-open-button" onClick={() => selectionMode ? toggleTaskSelection(task.id) : openTask(task)}>{task.title}</button>{task.hasPrivateNote && <StickyNote className="task-note-marker" size={11} aria-label="Tienes apuntes privados" />}</span>{task.isMilestone && <small>Hito</small>}</span><span className="mobile-owner-compact">{task.owner.name}</span></div>
            <div className="mobile-task-progress"><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><b>{task.progress}%</b></div>
            <div className="mobile-task-foot"><span>{task.isMilestone ? <span className="milestone-label">Hito</span> : <TaskBadge status={task.status} label={projectStatuses.find((item) => item.status === task.status)?.label} color={projectStatuses.find((item) => item.status === task.status)?.color} />}</span><i className={`task-priority priority-${task.priority === 3 ? "alta" : task.priority === 1 ? "baja" : "media"}`}>{task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media"}</i>{task.blockedBy && <span className="dependency-note"><Link2 size={12} /> {task.blockedBy}</span>}</div>
          </article>;
        })}
        {!visible.length && <div className="gantt-empty"><Check size={18} /><b>Aún no hay tareas visibles</b><span>{items.length ? "Expande una tarea o sección para ver sus subtareas." : readOnly ? "Este proyecto todavía no tiene planificación." : "Agrega la primera tarea para comenzar."}</span></div>}
      </div>}
      {!simpleView && !readOnly && !selectionMode && <button className="gantt-add-bottom" onClick={openTaskCreator}><Plus size={16} /> Agregar tarea/hito</button>}

      {!readOnly && assigneeEditorTask && assigneePopoverPosition && typeof document !== "undefined" && createPortal(<>
        <button type="button" className="gantt-assignee-dismiss" aria-label="Cerrar responsables" onClick={closeAssigneeEditor} />
        <div
          className={`gantt-assignee-popover placement-${assigneePopoverPosition.placement}`}
          role="dialog"
          aria-label={`Responsables de ${assigneeEditorTask.title}`}
          style={{ left: assigneePopoverPosition.left, top: assigneePopoverPosition.top, bottom: assigneePopoverPosition.bottom, maxHeight: assigneePopoverPosition.maxHeight }}
          onClick={(event) => event.stopPropagation()}
        >
          <header><div><b>Responsables</b><span>Selecciona uno o más</span></div><button type="button" onClick={closeAssigneeEditor} aria-label="Cerrar"><X size={14} /></button></header>
          <div className="gantt-assignee-options">
            {members.map((member) => {
              const externalId = member.user_id.startsWith("external:") ? member.user_id.replace("external:", "") : "";
              const selected = externalId
                ? assigneeEditorDirectoryIds.includes(externalId) || (!assigneeEditorDirectoryIds.length && assigneeEditorTask.manualAssignee === member.full_name)
                : assigneeEditorUserIds.includes(member.user_id);
              return <label className={selected ? "selected" : ""} key={member.user_id}><input type="checkbox" checked={selected} onChange={() => toggleInlineAssignee(assigneeEditorTask, member)} /><i>{initials(member.full_name || member.email)}</i><span>{member.full_name || member.email}</span><Check size={12} /></label>;
            })}
            {!members.length && <p>No hay responsables disponibles todavía.</p>}
          </div>
          <button type="button" className="gantt-assignee-manage" onClick={() => { closeAssigneeEditor(); openTask(assigneeEditorTask); }}><Plus size={13} /> Agregar otro nombre o ver detalles</button>
        </div>
      </>, isFullscreen && shellRef.current ? shellRef.current : document.body)}

      {createOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={createKind === "milestone" ? "Nuevo hito" : "Nueva tarea"}><button className="modal-backdrop" onClick={() => setCreateOpen(false)} /><section className="modal-card task-create-modal"><div className="modal-head"><div><span className="eyebrow">PLANIFICACIÓN</span><h2>{createKind === "milestone" ? "Nuevo hito" : "Nueva tarea"}</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)}><X size={19} /></button></div><form onSubmit={createTask}><div className="task-kind-switch"><button type="button" className={createKind === "task" ? "active" : ""} onClick={() => setCreateKind("task")}>Tarea</button><button type="button" className={createKind === "milestone" ? "active" : ""} onClick={() => setCreateKind("milestone")}>Hito</button></div><label className="field-label">Nombre<input name="title" autoFocus placeholder={createKind === "milestone" ? "Ej. Aprobación de ingeniería" : "Ej. Revisar ingeniería de detalle"} required /></label><div className="form-grid"><label className="field-label">Sección<div className="section-select-row"><select value={taskSection} onChange={(event) => setTaskSection(event.target.value)}>{sections.map((section) => <option value={section} key={section}>{section}</option>)}</select><button type="button" className="icon-button" onClick={() => { setSectionError(""); setSectionOpen(true); }} title="Agregar sección"><Plus size={17} /></button></div></label><label className="field-label">Estado<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as TaskStatus)}>{statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label></div><div className="form-grid">{createKind === "task" && <label className="field-label">Inicio<input name="start_date" type="date" /></label>}<label className="field-label">{createKind === "milestone" ? "Fecha del hito" : "Fecha límite"}<input name="due_date" type="date" /></label></div><div className="multi-assignee-field create-task-assignees"><span>Responsables</span><div>{members.map((member) => { const selected = createAssignees.includes(member.user_id); return <button type="button" className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setCreateAssignees((current) => current.includes(member.user_id) ? current.filter((id) => id !== member.user_id) : [...current, member.user_id])} key={member.user_id}><i>{initials(member.full_name)}</i><b>{member.full_name || member.email}</b><Check size={12} /></button>; })}{!members.length && <small>No hay integrantes ni responsables guardados.</small>}</div><label className="new-project-assignee"><span>Agregar responsable del proyecto</span><input value={manualAssignee} onChange={(event) => setManualAssignee(event.target.value)} placeholder="Nombre de proveedor, contacto o apoyo" /><small>Quedará disponible para las próximas tareas.</small></label></div><label className="field-label">Prioridad<select value={taskPriority} onChange={(event) => setTaskPriority(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option></select></label><div className="task-color-picker"><span>Color</span><div>{colors.map((color) => <button type="button" key={color} className={taskColor === color ? "selected" : ""} style={{ background: color }} onClick={() => setTaskColor(color)} aria-label={`Usar color ${color}`} />)}<label title="Color personalizado"><input type="color" value={taskColor} onChange={(event) => setTaskColor(event.target.value)} /></label></div></div>{createError && <p className="form-error">{createError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="button primary" disabled={creating}>{creating ? "Creando..." : `Crear ${createKind === "milestone" ? "hito" : "tarea"}`}</button></div></form></section></div>}
      {sectionOpen && <div className="modal-layer nested-modal" role="dialog" aria-modal="true" aria-label="Nueva sección"><button className="modal-backdrop" onClick={() => setSectionOpen(false)} /><section className="modal-card section-modal"><div className="modal-head"><div><span className="eyebrow">ESTRUCTURA</span><h2>Nueva sección</h2></div><button className="icon-button" onClick={() => setSectionOpen(false)}><X size={19} /></button></div><label className="field-label">Nombre<input autoFocus value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addProjectSection(); } }} placeholder="Ej. Ingeniería, Compras o Puesta en marcha" /></label>{sectionError && <p className="form-error">{sectionError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setSectionOpen(false)}>Cancelar</button><button type="button" className="button primary" disabled={sectionSaving || !sectionDraft.trim()} onClick={addProjectSection}>{sectionSaving ? "Guardando..." : "Agregar sección"}</button></div></section></div>}
    </div>
  );
}
