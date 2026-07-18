"use client";

import {
  AlertTriangle, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, CornerDownRight,
  Columns3, Link2, Maximize2, Minimize2, Plus, Presentation, X,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Person, Task, TaskStatus } from "@/lib/types";
import { defaultProjectStatuses, type ProjectTaskStatus } from "@/lib/task-statuses";
import { taskDisplayColor, type TaskColorMode } from "@/lib/task-colors";
import { sortTasksByDate, taskDateKey, taskDepth, taskDisplaySection } from "@/lib/task-order";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { TaskBadge } from "./status";

type AssignableMember = { user_id: string; full_name: string; email: string };
type DragState = { taskId: string; startX: number; startY: number; width: number; start: Date; due: Date; deltaDays: number; previous: Task[] };
type ColumnKey = "task" | "owner" | "status" | "priority" | "progress" | "startDate" | "dueDate";
type ColumnResizeState = { column: ColumnKey; startX: number; startWidth: number; min: number; max: number; scale: number };

const colors = ["#2f7669", "#3778a6", "#7f5aa6", "#c07a32", "#b64e4e", "#68766f"];
const defaultColumnWidths: Record<ColumnKey, number> = { task: 235, owner: 120, status: 90, priority: 78, progress: 70, startDate: 92, dueDate: 92 };
const defaultVisibleColumns: Record<ColumnKey, boolean> = { task: true, owner: true, status: true, priority: true, progress: true, startDate: false, dueDate: false };
function dateValue(date: Date) { return format(date, "yyyy-MM-dd"); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—"; }
function memberPerson(member: AssignableMember): Person {
  return { id: member.user_id, name: member.full_name || member.email.split("@")[0], initials: initials(member.full_name || member.email), role: "Ingeniero", color: "#476f8f" };
}
const unassigned: Person = { id: "unassigned", name: "Sin asignar", initials: "—", role: "Ingeniero", color: "#98a6a0" };

export function GanttBoard({ initialTasks, projectId, timelineStart, readOnly = false, colorMode = "manual", projectStatuses = defaultProjectStatuses, onTasksChange, onOpenTask }: { initialTasks: Task[]; projectId: string; timelineStart?: string; readOnly?: boolean; colorMode?: TaskColorMode; projectStatuses?: ProjectTaskStatus[]; onTasksChange?: (tasks: Task[]) => void; onOpenTask?: (task: Task) => void }) {
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
  const [assigneeChoice, setAssigneeChoice] = useState("");
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
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const columnResizeRef = useRef<ColumnResizeState | null>(null);
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
  const orderedItems = useMemo(() => sortTasksByDate(items), [items]);
  const sections = useMemo(() => Array.from(new Set([...sectionOptions, ...items.map((item) => taskDisplaySection(item, items))])).sort((left, right) => {
    const leftTask = orderedItems.find((item) => taskDisplaySection(item, items) === left);
    const rightTask = orderedItems.find((item) => taskDisplaySection(item, items) === right);
    return (leftTask ? taskDateKey(leftTask) : "9999-12-31").localeCompare(rightTask ? taskDateKey(rightTask) : "9999-12-31");
  }), [items, orderedItems, sectionOptions]);
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
  const activeStatuses = useMemo(() => projectStatuses.filter((item) => item.enabled).sort((left, right) => left.sortOrder - right.sortOrder), [projectStatuses]);
  const statuses = useMemo(() => activeStatuses.map((item) => ({ value: item.status, label: item.label })), [activeStatuses]);

  useEffect(() => {
    if (!activeStatuses.some((item) => item.status === taskStatus)) setTaskStatus(activeStatuses[0]?.status ?? "todo");
  }, [activeStatuses, taskStatus]);

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
      if (memberResult.data) setMembers([...(memberResult.data as AssignableMember[]), ...((externalResult.data || []).map((item) => ({ user_id: `external:${item.id}`, full_name: item.name, email: "Externo" })))]);
    };
    load();
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    const listener = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

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
      const signature = (list: Task[]) => JSON.stringify(list.map((task) => [task.id, task.parentId, task.title, task.section, task.status, task.progress, task.priority, task.startDate, task.dueDate, task.color, task.assigneeId, task.manualAssignee, task.rollupProgress]));
      if (signature(current) === signature(normalized)) return current;
      syncingFromParentRef.current = true;
      return normalized;
    });
  }, [initialTasks, projectBase]);

  const openTaskCreator = () => {
    setCreateError(""); setCreateKind("task"); setTaskSection(sections[0] ?? "General");
    setTaskColor(colors[0]); setTaskStatus("todo"); setTaskPriority(2); setAssigneeChoice(""); setManualAssignee(""); setCreateOpen(true);
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
      const selectedChoice = members.find((member) => member.user_id === assigneeChoice);
      const externalName = assigneeChoice.startsWith("external:") ? selectedChoice?.full_name : assigneeChoice === "__manual__" ? manualAssignee.trim() : "";
      const { data: taskId, error } = await createClient()!.rpc("create_task_with_details", {
        target_project: projectId, task_title: title, task_section: taskSection,
        task_start: startDate, task_due: dueDate || null, task_is_milestone: createKind === "milestone",
        task_color: taskColor, task_status: taskStatus,
        target_assignee: assigneeChoice && assigneeChoice !== "__manual__" && !assigneeChoice.startsWith("external:") ? assigneeChoice : null,
        assignee_label: externalName || null,
      });
      if (error) { setCreateError(error.code === "PGRST202" ? "Falta aplicar la migración 202607140005_interactive_gantt.sql." : error.message); setCreating(false); return; }
      const { error: priorityError } = await createClient()!.rpc("set_task_priority", { target_task: taskId, next_priority: taskPriority });
      if (priorityError) { setCreateError(priorityError.code === "PGRST202" ? "Falta aplicar la migración 202607150009_task_priority_external_assignees.sql." : priorityError.message); setCreating(false); return; }
      if (assigneeChoice === "__manual__" && manualAssignee.trim()) {
        const { data: externalId } = await createClient()!.rpc("remember_external_assignee", { target_project: projectId, assignee_name: manualAssignee.trim() });
        if (externalId) setMembers((current) => current.some((item) => item.user_id === `external:${externalId}`) ? current : [...current, { user_id: `external:${externalId}`, full_name: manualAssignee.trim(), email: "Externo" }]);
      }
      const selectedMember = members.find((member) => member.user_id === assigneeChoice && !member.user_id.startsWith("external:"));
      const owner = selectedMember ? memberPerson(selectedMember) : externalName
        ? { ...unassigned, id: `manual-${taskId}`, name: externalName, initials: initials(externalName) }
        : unassigned;
      const start = new Date(`${startDate}T12:00:00`);
      const due = dueDate ? new Date(`${dueDate}T12:00:00`) : start;
      setItems((current) => [...current, {
        id: String(taskId), projectId, title, section: taskSection, owner,
        start: differenceInCalendarDays(start, projectBase) + 1,
        duration: createKind === "milestone" ? 1 : Math.max(1, differenceInCalendarDays(due, start) + 1),
        progress: taskStatus === "done" ? 100 : 0, status: taskStatus, priority: taskPriority,
        due: dueDate ? format(due, "dd MMM", { locale: es }) : "Sin fecha",
        startDate, dueDate, isMilestone: createKind === "milestone", color: taskColor,
        assigneeId: selectedMember?.user_id, manualAssignee: externalName || undefined,
      }]);
    }
    setCreating(false); setCreateOpen(false);
  };

  const updatePresentation = async (taskId: string, nextStatus: TaskStatus, nextColor: string) => {
    const previous = items;
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, status: nextStatus, color: nextColor, progress: nextStatus === "done" ? 100 : task.status === "done" ? 0 : task.progress } : task));
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

  const updateOwner = async (task: Task, memberId: string) => {
    const previous = items;
    const member = members.find((item) => item.user_id === memberId);
    const externalName = memberId.startsWith("external:") ? member?.full_name : undefined;
    setItems((current) => current.map((item) => item.id === task.id ? { ...item, owner: externalName ? { ...unassigned, id: memberId, name: externalName, initials: initials(externalName) } : member ? memberPerson(member) : unassigned, assigneeId: externalName ? undefined : member?.user_id, manualAssignee: externalName } : item));
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("set_task_owner", { target_task: task.id, target_assignee: memberId && !memberId.startsWith("external:") ? memberId : null, assignee_label: externalName || null });
    if (error) { setItems(previous); setInteractionError(error.message); }
  };

  const updateProgress = async (taskId: string, nextProgress: number) => {
    const progress = Math.min(100, Math.max(0, nextProgress));
    const previous = items;
    setItems((current) => current.map((task) => task.id === taskId ? { ...task, progress, status: progress === 100 ? "done" : task.status === "done" ? "progress" : task.status } : task));
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

  const moveHierarchy = async (taskId: string, parentId: string | null, section: string) => {
    const moving = items.find((task) => task.id === taskId);
    const parent = parentId ? items.find((task) => task.id === parentId) : undefined;
    if (!moving || taskId === parentId) return;
    const branch = branchIds(taskId);
    if (parentId && branch.has(parentId)) { setInteractionError("No puedes mover una tarea dentro de su propia rama."); return; }
    const subtreeDepth = Math.max(0, ...Array.from(branch).map((id) => taskDepth(items.find((task) => task.id === id)!, items) - taskDepth(moving, items)));
    if (parent && taskDepth(parent, items) + 1 + subtreeDepth > 2) { setInteractionError("El movimiento superaría el límite de sub-subtareas."); return; }
    const nextSection = parent ? taskDisplaySection(parent, items) : section;
    const previous = items;
    setItems((current) => current.map((task) => branch.has(task.id) ? { ...task, parentId: task.id === taskId ? parentId || undefined : task.parentId, section: nextSection } : task));
    setCollapsedParents((current) => parentId ? current.filter((id) => id !== parentId) : current);
    setHierarchyDrag(null); setHierarchyTarget(null);
    if (!hasSupabaseConfig) return;
    const { error } = await createClient()!.rpc("move_task_in_hierarchy", { target_task: taskId, new_parent: parentId, target_section: nextSection });
    if (error) {
      setItems(previous);
      setInteractionError(error.code === "PGRST202" ? "Falta aplicar la migración 202607170010_drag_hierarchy.sql." : error.message);
    }
  };

  const startHierarchyDrag = (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
    if (readOnly) return;
    setHierarchyDrag(taskId); setHierarchyTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
  };

  const dropOnTask = (event: React.DragEvent<HTMLDivElement>, parentId: string) => {
    event.preventDefault(); event.stopPropagation();
    const taskId = hierarchyDrag || event.dataTransfer.getData("text/plain");
    const parent = items.find((task) => task.id === parentId);
    if (taskId && parent) moveHierarchy(taskId, parentId, taskDisplaySection(parent, items));
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, task: Task) => {
    if (readOnly || !task.startDate) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const start = new Date(`${task.startDate}T12:00:00`);
    const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : start;
    dragRef.current = { taskId: task.id, startX: event.clientX, startY: event.clientY, width: event.currentTarget.parentElement?.getBoundingClientRect().width || 1, start, due, deltaDays: 0, previous: items };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    if (Math.abs(event.clientY - drag.startY) > 16) {
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
  const hierarchyLabel = (task: Task) => taskDepth(task, items) === 2 ? "Sub-subtarea" : taskDepth(task, items) === 1 ? "Subtarea" : "";
  const dayLabelEvery = rangeDays <= 30 ? 1 : rangeDays <= 60 ? 2 : rangeDays <= 90 ? 3 : 7;
  const visibleColumnOrder: ColumnKey[] = ["task", "owner", "status", "priority", "progress", "startDate", "dueDate"];
  const gridTemplateColumns = `${visibleColumnOrder.filter((column) => visibleColumns[column]).map((column) => `${columnWidths[column]}px`).join(" ")} minmax(565px, 1fr)`;
  const informationWidth = visibleColumnOrder.filter((column) => visibleColumns[column]).reduce((sum, column) => sum + columnWidths[column], 0);
  const gridStyle = { gridTemplateColumns } as React.CSSProperties;
  const prettyDate = (value?: string) => value ? format(new Date(`${value}T12:00:00`), "dd MMM yy", { locale: es }) : "Sin fecha";
  const columnOptions: { key: ColumnKey; label: string }[] = [
    { key: "owner", label: "Responsable" }, { key: "status", label: "Estado" }, { key: "priority", label: "Prioridad" },
    { key: "progress", label: "Avance" }, { key: "startDate", label: "Fecha de inicio" }, { key: "dueDate", label: "Fecha de fin" },
  ];

  return (
    <div className={`gantt-shell ${readOnly ? "gantt-readonly" : ""}`} ref={shellRef}>
      <div className="gantt-toolbar">
        <div className="gantt-date-controls"><button className="icon-button period-button" onClick={() => setWindowStart((date) => addDays(date, -Math.ceil(rangeDays / 2)))} aria-label="Periodo anterior"><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setWindowStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoy</button><button className="icon-button period-button" onClick={() => setWindowStart((date) => addDays(date, Math.ceil(rangeDays / 2)))} aria-label="Periodo siguiente"><ChevronRight size={17} /></button><label className="range-select"><CalendarRange size={15} /><select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={28}>4 semanas</option><option value={56}>8 semanas</option><option value={84}>12 semanas</option><option value={182}>26 semanas</option></select></label></div>
        <div className="gantt-toolbar-actions">{!simpleView && <><span className="wheel-hint">Shift + rueda para navegar</span><div className="column-visibility"><button type="button" className={`button secondary small columns-button ${columnsOpen ? "active" : ""}`} onClick={() => setColumnsOpen((current) => !current)} aria-label="Mostrar u ocultar columnas"><Columns3 size={15} /> Columnas</button>{columnsOpen && <div className="column-visibility-menu"><header><b>Columnas visibles</b><span>Personaliza esta vista</span></header>{columnOptions.map((option) => <label key={option.key}><input type="checkbox" checked={visibleColumns[option.key]} onChange={() => toggleColumn(option.key)} /><span>{option.label}</span><i /></label>)}</div>}</div></>}<button className={`button secondary small simple-view-button ${simpleView ? "active" : ""}`} onClick={() => setSimpleView((current) => !current)}><Presentation size={15} />{simpleView ? "Vista completa" : "Vista simple"}</button>{!simpleView && !readOnly && <><button className="button secondary small section-button" onClick={() => { setSectionError(""); setSectionOpen(true); }}><Plus size={15} /> Sección</button><button className="button primary small" onClick={openTaskCreator}><Plus size={16} /> Agregar tarea/hito</button></>}<button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></div>
      </div>
      {interactionError && <div className="gantt-message"><AlertTriangle size={14} />{interactionError}<button onClick={() => setInteractionError("")}><X size={14} /></button></div>}
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
        <div className="gantt-grid gantt-header-row" style={gridStyle}><div className="gantt-task-head">TAREA{columnResizer("task", 180, 430)}</div>{visibleColumns.owner && <div className="gantt-owner-head">RESPONSABLE{columnResizer("owner", 90, 240)}</div>}{visibleColumns.status && <div className="gantt-status-head">ESTADO{columnResizer("status", 75, 180)}</div>}{visibleColumns.priority && <div className="gantt-priority-head">PRIORIDAD{columnResizer("priority", 65, 140)}</div>}{visibleColumns.progress && <div className="gantt-progress-head">AVANCE{columnResizer("progress", 65, 150)}</div>}{visibleColumns.startDate && <div className="gantt-date-head">INICIO{columnResizer("startDate", 78, 150)}</div>}{visibleColumns.dueDate && <div className="gantt-date-head">FIN{columnResizer("dueDate", 78, 150)}</div>}<div className="gantt-timeline-head"><div className="gantt-weeks" style={{ gridTemplateColumns: `repeat(${timelineSegments.length}, 1fr)` }}>{timelineSegments.map((segment, index) => <span key={`${segment}-${index}`}>{segment}</span>)}</div><div className="gantt-days" style={{ gridTemplateColumns: `repeat(${rangeDays}, 1fr)` }}>{timelineDays.map((day, index) => <span className={dateValue(day) === todayKey ? "today" : ""} key={day.toISOString()}>{index % dayLabelEvery === 0 ? format(day, "d") : ""}</span>)}</div></div></div>
        <div className="gantt-body">
          {todayOffset >= 0 && todayOffset < rangeDays && <div className="today-line" style={{ left: `calc(${informationWidth}px + (100% - ${informationWidth}px) * ${todayOffset / rangeDays})` }} />}
          {sections.map((section) => (
            <div key={section} className="gantt-section-wrap">
              <button data-section-drop={section} className={`gantt-section ${hierarchyDrag ? "hierarchy-drop-section" : ""} ${hierarchyTarget === `section:${section}` ? "drop-active" : ""}`} onClick={() => setCollapsed((state) => state.includes(section) ? state.filter((name) => name !== section) : [...state, section])} onDragOver={(event) => { if (!hierarchyDrag) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setHierarchyTarget(`section:${section}`); }} onDragLeave={() => setHierarchyTarget((current) => current === `section:${section}` ? null : current)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const taskId = hierarchyDrag || event.dataTransfer.getData("text/plain"); if (taskId) moveHierarchy(taskId, null, section); }}>
                {collapsed.includes(section) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <b>{section}</b><span>{hierarchyDrag ? "Soltar como principal" : allTasksInSection(section).length}</span>
              </button>
              {!collapsed.includes(section) && tasksInSection(section).map((task) => {
                const taskHasChildren = hasChildren(task);
                const depth = taskDepth(task, items);
                const priorityLabel = task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media";
                const rememberedExternal = task.manualAssignee ? members.find((member) => member.user_id.startsWith("external:") && member.full_name.toLowerCase() === task.manualAssignee?.toLowerCase()) : undefined;
                return <div data-task-drop={task.id} className={`gantt-grid gantt-task-row ${hierarchyTarget === task.id ? "hierarchy-drop-target" : ""} ${hierarchyDrag === task.id ? "hierarchy-dragging" : ""}`} key={task.id} style={gridStyle} onDragOver={(event) => { if (!hierarchyDrag || hierarchyDrag === task.id) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setHierarchyTarget(task.id); }} onDragLeave={() => setHierarchyTarget((current) => current === task.id ? null : current)} onDrop={(event) => dropOnTask(event, task.id)}>
                  <div className={`gantt-task-name task-depth-${depth}`} draggable={!readOnly} onDragStart={(event) => startHierarchyDrag(event, task.id)} onDragEnd={() => { setHierarchyDrag(null); setHierarchyTarget(null); }} title={readOnly ? undefined : "Arrastra para convertirla en subtarea o moverla a una sección"}>
                    <button className={`tiny-check ${task.status === "done" ? "checked" : ""}`} disabled={readOnly} onClick={() => updatePresentation(task.id, task.status === "done" ? "todo" : "done", task.color || colors[0])} title={readOnly ? "Estado visible en modo de consulta" : "Marcar como completada"}>{task.status === "done" && <Check size={12} />}</button>
                    <span className="task-tree-control">{taskHasChildren ? <button type="button" className={`hierarchy-toggle ${depth > 0 ? "hierarchy-branch" : "hierarchy-root"} ${collapsedParents.includes(task.id) ? "collapsed" : ""}`} onClick={() => setCollapsedParents((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} title={collapsedParents.includes(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"} aria-label={collapsedParents.includes(task.id) ? "Mostrar subtareas" : "Ocultar subtareas"}>{depth > 0 ? <CornerDownRight size={13} /> : <span className="root-chevron" />}</button> : depth > 0 ? <CornerDownRight className="subtask-arrow" size={13} /> : <span className="hierarchy-spacer" />}</span>
                    <span><span className="task-title-line"><button type="button" className="task-open-button" onClick={() => openTask(task)}>{task.title}</button></span>{(hierarchyLabel(task) || task.isMilestone) && <small>{hierarchyLabel(task) && <em>{hierarchyLabel(task)}</em>}{task.isMilestone && "Hito"}</small>}</span>
                    {!readOnly && colorMode === "manual" && <input className="task-color-input" type="color" value={task.color || colors[0]} onChange={(event) => setItems((current) => current.map((item) => item.id === task.id ? { ...item, color: event.target.value } : item))} onBlur={(event) => updatePresentation(task.id, task.status, event.target.value)} title="Color de la tarea" />}
                  </div>
                  {visibleColumns.owner && <div className="gantt-owner">{readOnly ? <><Avatar person={task.owner} size="sm" /><span>{task.owner.name}</span></> : <select value={task.manualAssignee ? rememberedExternal?.user_id || "external:manual_current" : task.assigneeId || ""} onChange={(event) => updateOwner(task, event.target.value)}><option value="">Sin asignar</option>{task.manualAssignee && !rememberedExternal && <option value="external:manual_current" disabled>{task.manualAssignee}</option>}{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.full_name}{member.user_id.startsWith("external:") ? " · Externo" : ""}</option>)}</select>}</div>}
                  {visibleColumns.status && <div className="gantt-status">{readOnly ? <TaskBadge status={task.status} label={projectStatuses.find((item) => item.status === task.status)?.label} color={projectStatuses.find((item) => item.status === task.status)?.color} /> : <select value={task.status} onChange={(event) => updatePresentation(task.id, event.target.value as TaskStatus, task.color || colors[0])}>{statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select>}</div>}
                  {visibleColumns.priority && <div className="gantt-priority">{readOnly ? <span className={`priority-value priority-${priorityLabel.toLowerCase()}`}>{priorityLabel}</span> : <select className={`priority-select priority-${priorityLabel.toLowerCase()}`} value={task.priority || 2} onChange={(event) => updatePriority(task.id, Number(event.target.value) as 1 | 2 | 3)} aria-label={`Prioridad de ${task.title}`}><option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option></select>}</div>}
                  {visibleColumns.progress && <div className="gantt-progress-cell" title={task.rollupProgress ? "Calculado desde subtareas" : undefined}>{readOnly || task.rollupProgress ? <div className="gantt-progress-read"><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><b>{task.progress}%</b></div> : <label className="gantt-progress-control"><span>{task.progress}%</span><input type="range" min="0" max="100" step="5" value={task.progress} onChange={(event) => setItems((current) => current.map((item) => item.id === task.id ? { ...item, progress: Number(event.target.value) } : item))} onPointerUp={(event) => updateProgress(task.id, Number(event.currentTarget.value))} onKeyUp={(event) => updateProgress(task.id, Number(event.currentTarget.value))} onBlur={(event) => updateProgress(task.id, Number(event.currentTarget.value))} aria-label={`Avance de ${task.title}`} /></label>}</div>}
                  {visibleColumns.startDate && <div className="gantt-date-cell">{prettyDate(task.startDate)}</div>}
                  {visibleColumns.dueDate && <div className={`gantt-date-cell ${task.overdue ? "overdue" : ""}`}>{prettyDate(task.dueDate)}</div>}
                  <div className="gantt-timeline"><div className={`gantt-bar bar-${task.status} ${task.isMilestone ? "gantt-milestone" : ""} ${dragRef.current?.taskId === task.id ? "dragging" : ""}`} style={{ left: `${taskOffset(task) / rangeDays * 100}%`, width: task.isMilestone ? "18px" : `${taskWidth(task) / rangeDays * 100}%`, "--task-color": taskDisplayColor(task, colorMode) } as React.CSSProperties} title={`${task.title} · clic para abrir · arrastra para cambiar fechas`} onPointerDown={(event) => startDrag(event, task)} onPointerMove={moveDrag} onPointerUp={endDrag}><i style={{ width: `${task.progress}%` }} /><span>{task.isMilestone ? "" : task.progress > 0 ? `${task.progress}%` : ""}</span>{task.status === "blocked" && <AlertTriangle size={13} />}</div></div>
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
            <div><button className={`tiny-check ${task.status === "done" ? "checked" : ""}`} disabled={readOnly} onClick={() => updatePresentation(task.id, task.status === "done" ? "todo" : "done", task.color || colors[0])}>{task.status === "done" && <Check size={12} />}</button><span className="task-tree-control">{taskHasChildren ? <button type="button" className={`hierarchy-toggle ${depth > 0 ? "hierarchy-branch" : "hierarchy-root"} ${collapsedParents.includes(task.id) ? "collapsed" : ""}`} onClick={() => setCollapsedParents((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])}>{depth > 0 ? <CornerDownRight size={13} /> : <span className="root-chevron" />}</button> : depth > 0 ? <CornerDownRight className="subtask-arrow" size={13} /> : <span className="hierarchy-spacer" />}</span><span><span className="task-title-line"><button type="button" className="task-open-button" onClick={() => openTask(task)}>{task.title}</button></span>{(hierarchyLabel(task) || task.isMilestone) && <small>{hierarchyLabel(task) || "Hito"}</small>}</span><span className="mobile-owner-compact">{task.owner.name}</span></div>
            <div className="mobile-task-progress"><span><i style={{ width: `${task.progress}%`, background: taskDisplayColor(task, colorMode) }} /></span><b>{task.progress}%</b></div>
            <div className="mobile-task-foot"><span>{task.isMilestone ? <span className="milestone-label">Hito</span> : <TaskBadge status={task.status} label={projectStatuses.find((item) => item.status === task.status)?.label} color={projectStatuses.find((item) => item.status === task.status)?.color} />}</span><i className={`task-priority priority-${task.priority === 3 ? "alta" : task.priority === 1 ? "baja" : "media"}`}>{task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media"}</i>{task.blockedBy && <span className="dependency-note"><Link2 size={12} /> {task.blockedBy}</span>}</div>
          </article>;
        })}
        {!visible.length && <div className="gantt-empty"><Check size={18} /><b>Aún no hay tareas visibles</b><span>{items.length ? "Expande una tarea o sección para ver sus subtareas." : readOnly ? "Este proyecto todavía no tiene planificación." : "Agrega la primera tarea para comenzar."}</span></div>}
      </div>}
      {!simpleView && !readOnly && <button className="gantt-add-bottom" onClick={openTaskCreator}><Plus size={16} /> Agregar tarea/hito</button>}

      {createOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={createKind === "milestone" ? "Nuevo hito" : "Nueva tarea"}><button className="modal-backdrop" onClick={() => setCreateOpen(false)} /><section className="modal-card task-create-modal"><div className="modal-head"><div><span className="eyebrow">PLANIFICACIÓN</span><h2>{createKind === "milestone" ? "Nuevo hito" : "Nueva tarea"}</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)}><X size={19} /></button></div><form onSubmit={createTask}><div className="task-kind-switch"><button type="button" className={createKind === "task" ? "active" : ""} onClick={() => setCreateKind("task")}>Tarea</button><button type="button" className={createKind === "milestone" ? "active" : ""} onClick={() => setCreateKind("milestone")}>Hito</button></div><label className="field-label">Nombre<input name="title" autoFocus placeholder={createKind === "milestone" ? "Ej. Aprobación de ingeniería" : "Ej. Revisar ingeniería de detalle"} required /></label><div className="form-grid"><label className="field-label">Sección<div className="section-select-row"><select value={taskSection} onChange={(event) => setTaskSection(event.target.value)}>{sections.map((section) => <option value={section} key={section}>{section}</option>)}</select><button type="button" className="icon-button" onClick={() => { setSectionError(""); setSectionOpen(true); }} title="Agregar sección"><Plus size={17} /></button></div></label><label className="field-label">Estado<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as TaskStatus)}>{statuses.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label></div><div className="form-grid">{createKind === "task" && <label className="field-label">Inicio<input name="start_date" type="date" /></label>}<label className="field-label">{createKind === "milestone" ? "Fecha del hito" : "Fecha límite"}<input name="due_date" type="date" /></label></div><label className="field-label">Responsable<select value={assigneeChoice} onChange={(event) => setAssigneeChoice(event.target.value)}><option value="">Sin asignar</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.full_name}{member.user_id.startsWith("external:") ? " · Externo" : ""}</option>)}<option value="__manual__">Otro nombre (externo o ficticio)…</option></select></label>{assigneeChoice === "__manual__" && <label className="field-label">Nombre del responsable<input value={manualAssignee} onChange={(event) => setManualAssignee(event.target.value)} placeholder="Ej. Contratista eléctrico" required /></label>}<label className="field-label">Prioridad<select value={taskPriority} onChange={(event) => setTaskPriority(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option></select></label><div className="task-color-picker"><span>Color</span><div>{colors.map((color) => <button type="button" key={color} className={taskColor === color ? "selected" : ""} style={{ background: color }} onClick={() => setTaskColor(color)} aria-label={`Usar color ${color}`} />)}<label title="Color personalizado"><input type="color" value={taskColor} onChange={(event) => setTaskColor(event.target.value)} /></label></div></div>{createError && <p className="form-error">{createError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="button primary" disabled={creating}>{creating ? "Creando..." : `Crear ${createKind === "milestone" ? "hito" : "tarea"}`}</button></div></form></section></div>}
      {sectionOpen && <div className="modal-layer nested-modal" role="dialog" aria-modal="true" aria-label="Nueva sección"><button className="modal-backdrop" onClick={() => setSectionOpen(false)} /><section className="modal-card section-modal"><div className="modal-head"><div><span className="eyebrow">ESTRUCTURA</span><h2>Nueva sección</h2></div><button className="icon-button" onClick={() => setSectionOpen(false)}><X size={19} /></button></div><label className="field-label">Nombre<input autoFocus value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addProjectSection(); } }} placeholder="Ej. Ingeniería, Compras o Puesta en marcha" /></label>{sectionError && <p className="form-error">{sectionError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setSectionOpen(false)}>Cancelar</button><button type="button" className="button primary" disabled={sectionSaving || !sectionDraft.trim()} onClick={addProjectSection}>{sectionSaving ? "Guardando..." : "Agregar sección"}</button></div></section></div>}
    </div>
  );
}
