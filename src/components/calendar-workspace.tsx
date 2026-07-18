"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDays, format, isSameDay, parseISO, startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  FileSpreadsheet, Filter, Flag, Milestone, Plus, Printer,
  RotateCcw, Search, UserRound, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CalendarItem, CalendarItemKind, CalendarProjectOption } from "@/lib/supabase/calendar-data";
import { createClient } from "@/lib/supabase/client";

type ItemFilter = "all" | CalendarItemKind;
type StatusFilter = "all" | "open" | "overdue" | "done";
type ScopeFilter = "all" | "personal" | "team";

const kindLabels: Record<CalendarItemKind, string> = {
  task: "Tarea", milestone: "Hito", followup: "Seguimiento", personal: "Personal",
};

function cleanCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function CalendarWorkspace({ initialItems, projects, userId, workspaceId }: {
  initialItems: CalendarItem[];
  projects: CalendarProjectOption[];
  userId: string | null;
  workspaceId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [windowStart, setWindowStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [projectFilter, setProjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ItemFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<CalendarItemKind>("task");
  const [createProject, setCreateProject] = useState(projects.find((project) => project.canEdit)?.id ?? "");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setItems(initialItems), [initialItems]);

  const editableProjects = useMemo(() => projects.filter((project) => project.canEdit), [projects]);
  const days = useMemo(() => Array.from({ length: 28 }, (_, index) => addDays(windowStart, index)), [windowStart]);
  const windowEnd = days[27];
  const owners = useMemo(() => Array.from(new Set(items.map((item) => item.ownerName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    if (projectFilter !== "all" && item.projectId !== projectFilter) return false;
    if (typeFilter !== "all" && item.kind !== typeFilter) return false;
    if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
    if (statusFilter === "open" && item.done) return false;
    if (statusFilter === "overdue" && (!item.overdue || item.done)) return false;
    if (statusFilter === "done" && !item.done) return false;
    if (ownerFilter !== "all" && item.ownerName !== ownerFilter) return false;
    if (dateFrom && item.date < dateFrom) return false;
    if (dateTo && item.date > dateTo) return false;
    if (search.trim() && !`${item.title} ${item.projectName} ${item.ownerName}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  }), [items, projectFilter, typeFilter, scopeFilter, statusFilter, ownerFilter, dateFrom, dateTo, search]);
  const visibleItems = filteredItems.filter((item) => item.date >= format(windowStart, "yyyy-MM-dd") && item.date <= format(windowEnd, "yyyy-MM-dd"));
  const legendProjects = projects.filter((project) => items.some((item) => item.projectId === project.id && item.date >= format(windowStart, "yyyy-MM-dd") && item.date <= format(windowEnd, "yyyy-MM-dd")));
  const byDate = useMemo(() => {
    const result = new Map<string, CalendarItem[]>();
    for (const item of visibleItems) result.set(item.date, [...(result.get(item.date) ?? []), item]);
    for (const dayItems of result.values()) dayItems.sort((a, b) => Number(a.done) - Number(b.done) || Number(b.overdue) - Number(a.overdue) || b.priority - a.priority);
    return result;
  }, [visibleItems]);
  const rangeLabel = `${format(windowStart, "d MMM", { locale: es })} — ${format(windowEnd, "d MMM yyyy", { locale: es })}`;

  const openCreate = (date: string) => {
    setCreateDate(date);
    setStartDate(date);
    setDueDate(date);
    setTitle("");
    setOwnerName("");
    setError("");
    const firstProject = editableProjects[0]?.id ?? "";
    setCreateProject(firstProject);
    setCreateKind(firstProject ? "task" : "personal");
  };

  const resetFilters = () => {
    setProjectFilter("all"); setTypeFilter("all"); setScopeFilter("all"); setStatusFilter("open");
    setOwnerFilter("all"); setSearch(""); setDateFrom(""); setDateTo("");
  };

  const exportExcel = () => {
    const rows = visibleItems.map((item) => `<tr><td>${cleanCell(item.date)}</td><td>${cleanCell(kindLabels[item.kind])}</td><td>${cleanCell(item.title)}</td><td>${cleanCell(item.projectName)}</td><td>${cleanCell(item.ownerName)}</td><td>${item.done ? "Completado" : item.overdue ? "Atrasado" : "Pendiente"}</td></tr>`).join("");
    const html = `<html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr><th>Fecha</th><th>Tipo</th><th>Nombre</th><th>Proyecto</th><th>Responsable</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `calendario-orbit-${format(windowStart, "yyyy-MM-dd")}.xls`; link.click(); URL.revokeObjectURL(url);
  };

  const createItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createDate || !userId || !title.trim()) return;
    if (createKind !== "personal" && !createProject) { setError("Selecciona un proyecto editable."); return; }
    setSaving(true); setError("");
    const supabase = createClient()!;
    const project = projects.find((item) => item.id === createProject);
    let newId = crypto.randomUUID();
    let failure: { message: string } | null = null;

    if (createKind === "personal") {
      const targetWorkspace = workspaceId || project?.workspaceId || editableProjects[0]?.workspaceId;
      if (!targetWorkspace) { setError("Necesitas un grupo o proyecto asociado para guardar el pendiente personal."); setSaving(false); return; }
      const result = await supabase.from("weekly_items").insert({
        workspace_id: targetWorkspace, user_id: userId, title: title.trim(),
        week_start: format(startOfWeek(parseISO(dueDate || createDate), { weekStartsOn: 1 }), "yyyy-MM-dd"),
        due_date: dueDate || createDate,
      }).select("id").single();
      failure = result.error; newId = result.data?.id ?? newId;
    } else if (createKind === "followup") {
      const result = await supabase.from("project_followups").insert({
        project_id: createProject, title: title.trim(), due_date: dueDate || createDate,
        owner_label: ownerName.trim() || null, status: "open", is_blocker: false, created_by: userId,
      }).select("id").single();
      failure = result.error; newId = result.data?.id ?? newId;
    } else {
      const isMilestone = createKind === "milestone";
      const result = await supabase.rpc("create_task_with_details", {
        target_project: createProject,
        task_title: title.trim(),
        task_section: "General",
        task_start: startDate || createDate,
        task_due: isMilestone ? (dueDate || createDate) : (dueDate || startDate || createDate),
        task_is_milestone: isMilestone,
        task_color: project?.color || "#2f7669",
        task_status: "todo",
        target_assignee: null,
        assignee_label: ownerName.trim() || null,
      });
      failure = result.error; newId = String(result.data ?? newId);
    }

    if (failure) { setError(failure.message); setSaving(false); return; }
    const itemDate = dueDate || createDate;
    setItems((current) => [...current, {
      id: `${createKind}:${newId}`, title: title.trim(), kind: createKind, date: itemDate,
      startDate: startDate || createDate, projectId: createKind === "personal" ? null : createProject,
      projectName: createKind === "personal" ? "Personal" : project?.name ?? "Proyecto",
      projectCode: project?.code, projectColor: createKind === "personal" ? "#5278a3" : project?.color ?? "#2f7669",
      ownerId: createKind === "personal" ? userId : null, ownerName: createKind === "personal" ? "Yo" : ownerName.trim() || "Sin responsable",
      done: false, overdue: itemDate < format(new Date(), "yyyy-MM-dd"), priority: 2,
      scope: "personal",
    }]);
    setSaving(false); setCreateDate(null); router.refresh();
  };

  const kindIcon = (kind: CalendarItemKind) => kind === "milestone" ? <Milestone size={11} /> : kind === "followup" ? <Flag size={11} /> : kind === "personal" ? <UserRound size={11} /> : <CalendarClock size={11} />;
  const ownerInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

  return <>
    <section className="calendar-toolbar panel">
      <div className="calendar-nav"><button className="icon-button" onClick={() => setWindowStart(addDays(windowStart, -28))} aria-label="Cuatro semanas anteriores"><ChevronLeft size={18} /></button><button className="calendar-today" onClick={() => setWindowStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoy</button><button className="icon-button" onClick={() => setWindowStart(addDays(windowStart, 28))} aria-label="Cuatro semanas siguientes"><ChevronRight size={18} /></button><b>{rangeLabel}</b></div>
      <div className="calendar-export"><span><b>{visibleItems.filter((item) => !item.done).length}</b> pendientes visibles</span><button className="button secondary" onClick={exportExcel}><FileSpreadsheet size={15} /> Excel</button><button className="button secondary" onClick={() => window.print()}><Printer size={15} /> PDF</button></div>
    </section>

    <section className="calendar-filters panel">
      <label className="calendar-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tarea, proyecto o responsable" /></label>
      <label><span>Proyecto</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">Todos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as ItemFilter)}><option value="all">Todos</option><option value="task">Tareas</option><option value="milestone">Hitos</option><option value="followup">Seguimiento</option><option value="personal">Personales</option></select></label>
      <label><span>Propiedad</span><select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}><option value="all">Míos y del equipo</option><option value="personal">Mis proyectos</option><option value="team">Proyectos del equipo</option></select></label>
      <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="open">Pendientes</option><option value="overdue">Atrasados</option><option value="done">Completados</option><option value="all">Todos</option></select></label>
      <label><span>Responsable</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Todos</option>{owners.map((owner) => <option value={owner} key={owner}>{owner}</option>)}</select></label>
      <div className="calendar-date-range"><span>Rango de fechas</span><div><input type="date" aria-label="Fecha desde" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><i>—</i><input type="date" aria-label="Fecha hasta" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></div></div>
      <button className="icon-button calendar-reset" onClick={resetFilters} title="Limpiar filtros"><RotateCcw size={16} /></button>
    </section>

    <section className="calendar-context panel" aria-label="Leyenda del calendario">
      <div className="calendar-project-legend"><span>PROYECTOS EN VISTA</span><div><button className={projectFilter === "all" ? "active" : ""} onClick={() => setProjectFilter("all")}><i className="all" />Todos</button>{legendProjects.slice(0, 7).map((project) => <button className={projectFilter === project.id ? "active" : ""} onClick={() => setProjectFilter(project.id)} title={project.name} key={project.id}><i style={{ background: project.color }} /><span>{project.name}</span></button>)}</div></div>
      <div className="calendar-status-legend"><span><i className="open" />Pendiente</span><span><i className="late" />Atrasada</span><span><i className="done" />Completada</span></div>
    </section>

    <section className="calendar-board panel">
      <header className="calendar-weekdays">{["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((day) => <span key={day}>{day}</span>)}</header>
      <div className="calendar-grid">{days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayItems = byDate.get(key) ?? [];
        const today = isSameDay(day, new Date());
        return <article className={`calendar-day ${today ? "today" : ""} ${day.getDay() === 0 || day.getDay() === 6 ? "weekend" : ""}`} key={key}>
          <button className="calendar-day-head" onClick={() => openCreate(key)} title="Crear en este día"><span>{format(day, "EEE", { locale: es })}</span><b>{format(day, "d")}</b><Plus size={13} /></button>
          <div className="calendar-events">{dayItems.map((item) => {
            const stateLabel = item.done ? "Completada" : item.overdue ? "Atrasada" : "Pendiente";
            const content = <>
              <span className={`calendar-event-icon kind-${item.kind}`} title={kindLabels[item.kind]}>{kindIcon(item.kind)}</span>
              <span className="calendar-event-copy">
                <span className="calendar-project-ref" title={item.projectName}><i style={{ background: item.projectColor }} /><strong>{item.projectName}</strong></span>
                <b title={item.title}>{item.title}</b>
                <span className="calendar-event-meta"><i className="calendar-owner-initials">{ownerInitials(item.ownerName)}</i><span title={item.ownerName}>{item.ownerName}</span><em>{kindLabels[item.kind]}</em></span>
              </span>
              <span className={`calendar-event-state ${item.done ? "done" : item.overdue ? "late" : "open"}`} title={stateLabel}>{item.overdue && !item.done ? <CircleAlert size={11} /> : item.done ? <CheckCircle2 size={11} /> : <i />}</span>
            </>;
            const title = `${item.projectName} · ${item.title} · ${item.ownerName} · ${stateLabel}`;
            return item.projectId ? <Link href={`/projects/${item.projectId}`} className={`calendar-event ${item.done ? "done" : ""} ${item.overdue ? "overdue" : ""}`} style={{ "--event-color": item.projectColor } as React.CSSProperties} title={title} key={item.id}>{content}</Link> : <div className={`calendar-event ${item.done ? "done" : ""} ${item.overdue ? "overdue" : ""}`} style={{ "--event-color": item.projectColor } as React.CSSProperties} title={title} key={item.id}>{content}</div>;
          })}</div>
        </article>;
      })}</div>
      {!visibleItems.length && <div className="calendar-empty"><Filter size={20} /><b>No hay elementos para estos filtros</b><span>Pulsa cualquier día para crear una tarea, hito o pendiente.</span></div>}
    </section>

    {createDate && <div className="modal-layer calendar-create-layer" role="dialog" aria-modal="true" aria-label="Crear elemento en calendario"><button className="modal-backdrop" onClick={() => setCreateDate(null)} aria-label="Cerrar" /><section className="modal-card calendar-create-modal"><div className="modal-head"><div><span className="eyebrow">{format(parseISO(createDate), "EEEE d 'de' MMMM", { locale: es }).toUpperCase()}</span><h2>Agregar al calendario</h2></div><button className="icon-button" onClick={() => setCreateDate(null)}><X size={19} /></button></div><form onSubmit={createItem}>
      <div className="calendar-kind-picker">{(["task", "milestone", "followup", "personal"] as CalendarItemKind[]).map((kind) => <button type="button" className={createKind === kind ? "active" : ""} onClick={() => setCreateKind(kind)} disabled={kind !== "personal" && !editableProjects.length} key={kind}>{kindIcon(kind)}<span>{kindLabels[kind]}</span></button>)}</div>
      <label className="field-label">Nombre<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={createKind === "personal" ? "Ej. Preparar reunión semanal" : "Ej. Revisar entrega del proveedor"} required /></label>
      {createKind !== "personal" && <label className="field-label">Proyecto<select value={createProject} onChange={(event) => setCreateProject(event.target.value)} required>{editableProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>}
      <div className="form-grid">{createKind === "task" && <label className="field-label">Inicio<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>}<label className="field-label">{createKind === "milestone" ? "Fecha del hito" : "Vencimiento"}<input type="date" value={dueDate} min={createKind === "task" ? startDate || undefined : undefined} onChange={(event) => setDueDate(event.target.value)} /></label></div>
      {createKind !== "personal" && <label className="field-label">Responsable o referencia<input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Opcional · integrante o externo" /></label>}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCreateDate(null)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Guardando..." : `Crear ${kindLabels[createKind].toLowerCase()}`}</button></div>
    </form></section></div>}
  </>;
}
