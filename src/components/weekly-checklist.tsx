"use client";

import { CalendarDays, Check, ChevronDown, CircleAlert, CornerDownRight, Plus, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { WeeklyItemData } from "@/lib/supabase/week-data";
import { createClient } from "@/lib/supabase/client";

type DisplayItem = WeeklyItemData & { priorityLabel: "Alta" | "Media" | "Baja"; due: string; isOverdue: boolean };

export function WeeklyChecklist({ initialItems, workspaceId, userId, weekStart, onItemsChange }: { initialItems: WeeklyItemData[]; workspaceId: string | null; userId: string | null; weekStart: string; onItemsChange?: (items: WeeklyItemData[]) => void }) {
  const [items, setItems] = useState(initialItems);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(["Completadas"]));
  useEffect(() => { onItemsChange?.(items); }, [items, onItemsChange]);
  const displayItems: DisplayItem[] = items.map((item) => {
    const overdue = item.overdue ?? Boolean(item.dueDate && new Date(`${item.dueDate}T23:59:59`) < new Date() && !item.done);
    const priorityLabel = overdue || item.priority === 3 || item.isBlocker ? "Alta" : item.priority === 1 ? "Baja" : "Media";
    return { ...item, isOverdue: overdue, priorityLabel, due: item.dueDate ? `${overdue ? "Atrasada · " : ""}${format(new Date(`${item.dueDate}T12:00:00`), "EEE, dd MMM", { locale: es })}` : "Sin fecha" };
  });
  const currentWeekStart = weekStart;
  const currentWeekEnd = format(addDays(parseISO(weekStart), 6), "yyyy-MM-dd");
  const nextWeekStart = format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd");
  const nextWeekEnd = format(addDays(parseISO(weekStart), 13), "yyyy-MM-dd");
  const isCurrentWeek = (item: DisplayItem) => Boolean(item.dueDate && item.dueDate >= currentWeekStart && item.dueDate <= currentWeekEnd);
  const isNextWeek = (item: DisplayItem) => Boolean(item.dueDate && item.dueDate >= nextWeekStart && item.dueDate <= nextWeekEnd);
  const countsInWeekBadge = (item: WeeklyItemData) => item.source === "personal" || Boolean(item.dueDate && item.dueDate <= currentWeekEnd);
  const changeWeekBadge = (delta: number) => window.dispatchEvent(new CustomEvent<number>("orbit:week-pending-delta", { detail: delta }));
  const weeklyScope = displayItems.filter((item) => item.done || item.source === "personal" || item.isOverdue || isCurrentWeek(item));
  const completed = weeklyScope.filter((item) => item.done).length;
  const percentage = weeklyScope.length ? Math.round(completed / weeklyScope.length * 100) : 100;
  const groups = [
    { name: "Atrasadas · Seguimiento y compromisos", items: displayItems.filter((item) => !item.done && item.source === "followup" && item.isOverdue), className: "attention commitments" },
    { name: "Atrasadas · Carta Gantt", items: displayItems.filter((item) => !item.done && item.source === "task" && item.isOverdue), className: "attention gantt-late" },
    { name: "Vencen esta semana", items: displayItems.filter((item) => !item.done && item.source !== "personal" && !item.isOverdue && isCurrentWeek(item)), className: "week" },
    { name: "Personales", items: displayItems.filter((item) => !item.done && item.source === "personal"), className: "personal" },
    { name: "Vencen la semana siguiente", items: displayItems.filter((item) => !item.done && item.source !== "personal" && !item.isOverdue && isNextWeek(item)), className: "next-week" },
    { name: "Otras tareas abiertas", items: displayItems.filter((item) => !item.done && item.source !== "personal" && !item.isOverdue && !isCurrentWeek(item) && !isNextWeek(item)), className: "open" },
    { name: "Completadas", items: displayItems.filter((item) => item.done), className: "complete" },
  ];
  const toggleGroup = (name: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const toggle = async (id: string) => {
    const previous = items;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    setItems((current) => current.map((entry) => entry.id === id ? { ...entry, done: !entry.done } : entry));
    const supabase = createClient()!;
    let updateError;
    if (item.source === "task" && item.taskId) {
      let result = await supabase.rpc("update_task_progress", { target_task: item.taskId, next_progress: item.done ? 0 : 100 });
      if (result.error?.message.toLowerCase().includes("jwt issued at future")) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error) result = await supabase.rpc("update_task_progress", { target_task: item.taskId, next_progress: item.done ? 0 : 100 });
      }
      updateError = result.error;
    } else if (item.source === "followup") {
      const followupId = item.id.replace(/^followup:/, "");
      let result = await supabase.from("project_followups").update({ status: item.done ? "open" : "done", completed_at: item.done ? null : new Date().toISOString() }).eq("id", followupId);
      if (result.error?.message.toLowerCase().includes("jwt issued at future")) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error) result = await supabase.from("project_followups").update({ status: item.done ? "open" : "done", completed_at: item.done ? null : new Date().toISOString() }).eq("id", followupId);
      }
      updateError = result.error;
    } else {
      let result = await supabase.from("weekly_items").update({ completed_at: item.done ? null : new Date().toISOString() }).eq("id", id);
      if (result.error?.message.toLowerCase().includes("jwt issued at future")) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error) result = await supabase.from("weekly_items").update({ completed_at: item.done ? null : new Date().toISOString() }).eq("id", id);
      }
      updateError = result.error;
    }
    if (updateError) { setItems(previous); setError(updateError.message.toLowerCase().includes("jwt issued at future") ? "No fue posible renovar la sesión. Cierra sesión y vuelve a ingresar." : updateError.message); }
    else if (countsInWeekBadge(item)) changeWeekBadge(item.done ? 1 : -1);
  };
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (!workspaceId || !userId) { setError("Primero debes pertenecer a un grupo."); return; }
    const { data, error: insertError } = await createClient()!.from("weekly_items").insert({ workspace_id: workspaceId, user_id: userId, title, week_start: weekStart, due_date: dueDate || null }).select("id,title,due_date,completed_at,task_id").single();
    if (insertError) { setError(insertError.message); return; }
    setItems((current) => [...current, { id: data.id, title: data.title, project: "Pendiente personal", dueDate: data.due_date, done: false, taskId: data.task_id, source: "personal" }]);
    changeWeekBadge(1);
    setTitle(""); setDueDate(""); setAdding(false);
  };
  const remove = async (id: string) => {
    const previous = items; setItems((current) => current.filter((item) => item.id !== id));
    const { error: deleteError } = await createClient()!.from("weekly_items").delete().eq("id", id);
    if (deleteError) { setItems(previous); setError(deleteError.message); }
    else { const removed = previous.find((item) => item.id === id); if (removed && !removed.done) changeWeekBadge(-1); }
  };

  return <>
    <section className="week-overview panel"><div className="week-score"><span className="week-ring" style={{ "--week-value": `${percentage * 3.6}deg` } as React.CSSProperties}><b>{percentage}%</b></span><div><span className="eyebrow">PROGRESO SEMANAL</span><h3>{completed} de {weeklyScope.length} tareas y compromisos completados</h3><p>{weeklyScope.length ? "Incluye atrasos, vencimientos de esta semana y pendientes personales." : "Estás al día: no tienes pendientes para esta semana."}</p></div></div><div className="week-stats"><div><b>{weeklyScope.filter((item) => !item.done).length}</b><span>Por resolver esta semana</span></div><div className="danger"><b>{displayItems.filter((item) => !item.done && item.isOverdue).length}</b><span>Atrasadas</span></div><div><b>{completed}</b><span>Completadas</span></div></div></section>
    {error && <div className="group-message error"><CircleAlert />{error}</div>}
    <section className="checklist-panel panel">
      {groups.filter((group) => group.items.length > 0 || group.className === "personal").map((group) => { const collapsed = collapsedGroups.has(group.name); return <div className={`checklist-group ${group.className} ${collapsed ? "is-collapsed" : ""}`} key={group.name}><button type="button" className="checklist-group-head" onClick={() => toggleGroup(group.name)} aria-expanded={!collapsed}><span>{group.className.includes("attention") ? <CircleAlert size={17} /> : group.className === "complete" ? <Check size={17} /> : <CalendarDays size={17} />}<b>{group.name}</b><i>{group.items.length}</i></span><ChevronDown size={16} /></button>{!collapsed && group.items.map((item) => <div className={`checklist-row ${item.done ? "done" : ""}`} key={item.id}><button className="large-check" onClick={() => toggle(item.id)}>{item.done && <Check size={15} />}</button><div className="checklist-main"><b>{item.title}</b><span className="checklist-project"><i />{item.project}{item.source === "followup" ? " · Seguimiento" : item.source === "personal" ? " · Personal" : " · Carta Gantt"}</span><span className="checklist-context">{item.parentTitle && <em><CornerDownRight size={11} /> Tarea principal: {item.parentTitle}</em>}{item.owner && <em><UserRound size={11} /> {item.owner}</em>}</span></div><span className={`priority-tag priority-${item.priorityLabel.toLowerCase()}`}>{item.priorityLabel}</span><span className={`week-due ${item.isOverdue ? "overdue" : ""}`}>{item.due}</span>{item.source === "personal" ? <button className="row-more" onClick={() => remove(item.id)} title="Eliminar"><Trash2 size={16} /></button> : <span />}</div>)}</div>; })}
      {adding ? <form className="weekly-add-form" onSubmit={add}><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Escribe un pendiente..." required /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /><button type="button" className="button secondary" onClick={() => setAdding(false)}>Cancelar</button><button className="button primary">Agregar</button></form> : <button className="add-checklist" onClick={() => setAdding(true)}><Plus size={16} /> Agregar pendiente personal</button>}
    </section>
    <section className="week-footer-card"><div><span>VIERNES</span><h3>Cierra tu semana con claridad</h3><p>Revisa lo completado, registra bloqueos y prepara los compromisos de la próxima semana.</p></div></section>
  </>;
}
