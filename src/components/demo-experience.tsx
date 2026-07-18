"use client";

import Link from "next/link";
import { addDays, format, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft, BarChart3, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Columns3,
  CircleAlert, Clock3, FolderKanban, GanttChartSquare, Heart, LayoutDashboard,
  ListChecks, Maximize2, Milestone, Presentation, ShieldCheck, Sparkles, UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Logo } from "./logo";
import { Avatar } from "./avatar";
import { people, projects, tasks, weekItems } from "@/lib/demo-data";

type DemoView = "dashboard" | "gantt" | "calendar" | "tracking";

const viewLabels: Record<DemoView, string> = {
  dashboard: "Inicio", gantt: "Carta Gantt", calendar: "Calendario", tracking: "Seguimiento",
};

export function DemoExperience() {
  const [view, setView] = useState<DemoView>("dashboard");
  const [dashboardScope, setDashboardScope] = useState<"mine" | "team">("team");
  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const calendarDays = useMemo(() => Array.from({ length: 28 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const calendarEvents = useMemo(() => [
    { date: format(addDays(weekStart, 1), "yyyy-MM-dd"), title: "Aprobación técnica", project: "Expansión Planta Norte", owner: "Camila Rojas", color: "#a56a22", kind: "Hito" },
    { date: format(addDays(weekStart, 3), "yyyy-MM-dd"), title: "Cerrar layout de operaciones", project: "Centro Logístico", owner: "Tomás Silva", color: "#b4483d", kind: "Tarea" },
    { date: format(addDays(weekStart, 7), "yyyy-MM-dd"), title: "Reunión con proveedor PLC", project: "Automatización Línea 2", owner: "Martín Soto", color: "#277164", kind: "Seguimiento" },
    { date: format(addDays(weekStart, 10), "yyyy-MM-dd"), title: "Actualizar matriz de riesgos", project: "Personal", owner: "Felipe", color: "#5278a3", kind: "Personal" },
    { date: format(addDays(weekStart, 16), "yyyy-MM-dd"), title: "Recepción de equipamiento", project: "Expansión Planta Norte", owner: "Camila Rojas", color: "#a56a22", kind: "Hito" },
    { date: format(addDays(weekStart, 23), "yyyy-MM-dd"), title: "Pruebas de integración", project: "Automatización Línea 2", owner: "Martín Soto", color: "#277164", kind: "Tarea" },
  ], [weekStart]);
  const demoTeam = [
    { person: people[1], projects: [projects[0]], focus: [weekItems[0]], overdue: 0, average: 68 },
    { person: people[2], projects: [projects[0], projects[2]], focus: [weekItems[1]], overdue: 1, average: 55 },
    { person: people[3], projects: [projects[1]], focus: [weekItems[2]], overdue: 0, average: 82 },
    { person: people[4], projects: [projects[2]], focus: [weekItems[3]], overdue: 0, average: 41 },
  ];

  return <main className="demo-experience">
    <aside className="demo-sidebar">
      <Logo />
      <div className="demo-badge"><Sparkles size={13} /> DEMOSTRACIÓN INTERACTIVA</div>
      <nav>{(["dashboard", "gantt", "calendar", "tracking"] as DemoView[]).map((item) => {
        const Icon = item === "dashboard" ? LayoutDashboard : item === "gantt" ? GanttChartSquare : item === "calendar" ? CalendarDays : ListChecks;
        return <button className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}><Icon size={18} /><span>{viewLabels[item]}</span></button>;
      })}</nav>
      <div className="demo-sidebar-foot"><ShieldCheck size={15} /><span><b>Modo seguro</b><small>Datos ficticios · no se guarda nada</small></span></div>
      <span className="d2-sidebar-signature">Por y para Equipo D2 <Heart size={8} fill="currentColor" /></span>
    </aside>

    <section className="demo-main">
      <header className="demo-topbar"><div><span>DEMO / {viewLabels[view].toUpperCase()}</span><h1>{viewLabels[view]}</h1></div><Link href="/login" className="button secondary"><ArrowLeft size={15} /> Volver al acceso</Link></header>
      <div className="demo-content">
        {view === "dashboard" && <>
          <section className="page-heading dashboard-heading demo-welcome"><div><span className="date-kicker">VIERNES 17 DE JULIO</span><h2>Buenas tardes, Felipe <span>👋</span></h2><p>Este es el pulso de tus proyectos hoy.</p></div><div className="dashboard-heading-actions"><button className="button secondary" onClick={() => setView("calendar")}><CalendarDays size={16} /> Calendario</button><button className="button secondary" onClick={() => setView("tracking")}><ListChecks size={16} /> Seguimiento</button></div></section>
          <nav className="dashboard-scope-tabs demo-scope-tabs" aria-label="Alcance del tablero de demostración"><button className={dashboardScope === "mine" ? "active" : ""} onClick={() => setDashboardScope("mine")}>Mis proyectos <span>1</span></button><button className={dashboardScope === "team" ? "active" : ""} onClick={() => setDashboardScope("team")}>Equipo <span>3</span></button></nav>
          <section className="metric-grid demo-leader-metrics">{dashboardScope === "team" ? <><article className="metric-card"><span className="metric-icon green"><UserRoundCheck /></span><div><small>INGENIEROS MONITOREADOS</small><b>4</b><p>4 con proyectos visibles</p></div></article><article className="metric-card"><span className="metric-icon blue"><FolderKanban /></span><div><small>PROYECTOS DEL EQUIPO</small><b>3</b><p><strong>1</strong> avanza según lo esperado</p></div></article><article className="metric-card warning"><span className="metric-icon amber"><CircleAlert /></span><div><small>ATRASOS DEL EQUIPO</small><b>1</b><p>2 proyectos requieren atención</p></div></article><article className="metric-card"><span className="metric-icon violet"><BarChart3 /></span><div><small>AVANCE CONSOLIDADO</small><b>64%</b><p className="positive">Promedio de proyectos visibles</p></div></article></> : <><article className="metric-card"><span className="metric-icon green"><FolderKanban /></span><div><small>PROYECTOS ACTIVOS</small><b>1</b><p>Tu espacio personal</p></div></article><article className="metric-card"><span className="metric-icon blue"><CheckCircle2 /></span><div><small>COMPROMISOS ESTA SEMANA</small><b>2</b><p>1 completado · 0 atrasados</p></div></article><article className="metric-card"><span className="metric-icon amber"><CircleAlert /></span><div><small>REQUIEREN ATENCIÓN</small><b>0</b><p>Todo avanza según el plan</p></div></article><article className="metric-card"><span className="metric-icon violet"><BarChart3 /></span><div><small>AVANCE DE TUS PROYECTOS</small><b>74%</b><p className="positive">Avance personal</p></div></article></>}</section>
          {dashboardScope === "team" ? <section className="panel team-lead-panel demo-leader-panel"><div className="panel-head"><div><span className="eyebrow">VISTA DE JEFATURA</span><h3>Avance y compromisos por ingeniero</h3></div><button onClick={() => setView("tracking")}>Abrir seguimiento <ChevronRight size={15} /></button></div><div className="team-member-list">{demoTeam.map(({ person, projects: memberProjects, focus, overdue, average }) => <article className="team-member-row" key={person.id}><header className="team-member-head"><Avatar person={person} /><span className="team-member-copy"><b>{person.name}</b><small>{memberProjects.length} {memberProjects.length === 1 ? "proyecto visible" : "proyectos visibles"} · {focus.length} pendiente</small></span><span className={`team-member-alert ${overdue ? "late" : "clear"}`}>{overdue ? `${overdue} atrasada` : "Al día"}</span></header><div className="team-member-projects"><span className="team-card-label">PROYECTOS A CARGO</span>{memberProjects.slice(0, 2).map((project) => <button onClick={() => setView("gantt")} key={project.id}><i style={{ background: project.color }} /><span><b>{project.name}</b><small>{project.health === "healthy" ? "Avance dentro de lo esperado" : project.health === "risk" ? "Requiere seguimiento" : "Proyecto con atraso"}</small></span><strong>{project.progress}%</strong></button>)}</div><div className="team-member-focus"><span className="team-card-label">PRÓXIMOS COMPROMISOS</span>{focus.map((item) => <span key={item.id}><i className={overdue ? "late" : ""} /><span><b>{item.title}</b><small>{item.project} · {item.due}</small></span></span>)}</div><footer className="team-member-foot"><span>Avance promedio</span><span className="team-member-progress"><i><em style={{ width: `${average}%`, background: person.color }} /></i><b>{average}%</b></span></footer></article>)}</div></section> : <section className="demo-dashboard-grid"><article className="panel demo-focus"><header><div><span className="eyebrow">FOCO DE HOY</span><h3>Lo que necesita tu atención</h3></div><button onClick={() => setView("tracking")}>Ver seguimiento <ChevronRight size={15} /></button></header>{weekItems.filter((item) => item.owner.id === people[0].id).map((item) => <div key={item.id}><span className={`demo-check ${item.done ? "done" : ""}`}>{item.done && <Check size={12} />}</span><span><b>{item.title}</b><small>{item.project}</small></span><em>{item.due}</em></div>)}</article><article className="panel demo-personal-pulse"><span className="eyebrow">RESUMEN PERSONAL</span><h3>Tu planificación está al día</h3><p>Los proyectos privados permanecen separados de la supervisión del equipo.</p><strong>74%</strong></article></section>}
          <section className="demo-projects"><header><div><span className="eyebrow">EN MARCHA</span><h3>{dashboardScope === "team" ? "Proyectos visibles del equipo" : "Tus proyectos"}</h3></div></header><div>{(dashboardScope === "team" ? projects.slice(0, 3) : projects.slice(0, 1)).map((project) => <article key={project.id}><span className="demo-project-mark" style={{ background: project.color }}><FolderKanban size={16} /></span><div><small>{project.visibility}</small><h3>{project.name}</h3><p>{project.description}</p><footer><span><i style={{ width: `${project.progress}%`, background: project.color }} /></span><b>{project.progress}%</b></footer></div></article>)}</div></section>
        </>}

        {view === "gantt" && <section className="panel demo-gantt"><header><div><span className="eyebrow">EXPANSIÓN PLANTA NORTE</span><h2>Carta Gantt del equipo</h2><p>La misma vista que utiliza jefatura, en modo de consulta y presentación.</p></div><span>Solo lectura</span></header><div className="demo-gantt-toolbar"><div><button><ChevronLeft size={15} /></button><button>Hoy</button><button><ChevronRight size={15} /></button><span><CalendarDays size={14} /> 4 semanas</span></div><div><button><Columns3 size={14} /> Columnas</button><button><Presentation size={14} /> Vista simple</button><button className="fullscreen"><Maximize2 size={15} /></button></div></div><div className="demo-gantt-head"><b>Actividad</b>{Array.from({ length: 28 }, (_, index) => <span key={index}>{index + 1}</span>)}</div>{tasks.slice(0, 6).map((task, index) => <div className={`demo-gantt-row depth-${index === 2 || index === 4 ? 1 : 0}`} key={task.id}><div>{index === 2 || index === 4 ? <span className="demo-tree">↳</span> : <span className="demo-task-dot" style={{ background: task.owner.color }} />}<span><b>{task.title}</b><small>{task.owner.name} · {task.progress}%</small></span></div><div className="demo-gantt-track"><i style={{ left: `${Math.min(task.start * 3.2, 78)}%`, width: `${Math.max(task.duration * 3, 5)}%`, background: task.status === "blocked" ? "#b64b42" : task.owner.color }}><span style={{ width: `${task.progress}%` }} /></i>{task.isMilestone && <Milestone size={14} />}</div></div>)}</section>}

        {view === "calendar" && <section className="panel demo-calendar"><header><div><span className="eyebrow">TODOS LOS PROYECTOS</span><h2>Calendario de cuatro semanas</h2><p>Filtra por proyecto, responsable, tipo o estado y crea directamente sobre un día.</p></div><div><span>Personal y equipo</span><span>Todos los proyectos</span></div></header><div className="demo-calendar-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <b key={day}>{day}</b>)}</div><div className="demo-calendar-grid">{calendarDays.map((day) => { const key = format(day, "yyyy-MM-dd"); const events = calendarEvents.filter((event) => event.date === key); return <article key={key}><header><span>{format(day, "MMM", { locale: es })}</span><b>{format(day, "d")}</b></header>{events.map((event) => <div style={{ borderLeftColor: event.color }} key={event.title}><small><i style={{ background: event.color }} />{event.project}</small><b>{event.title}</b><em>{event.owner} · {event.kind}</em></div>)}</article>; })}</div></section>}

        {view === "tracking" && <><section className="demo-tracking-hero"><div><span className="eyebrow">CONTROL SEMANAL</span><h2>Todo lo que no puede perderse</h2><p>Atrasos de la Gantt, compromisos, bloqueos y recordatorios personales.</p></div><strong>64%<small>avance semanal</small></strong></section><section className="demo-tracking-groups">{[{ title: "Atrasadas", color: "red", items: weekItems.slice(1, 2) }, { title: "Vencen esta semana", color: "green", items: weekItems.slice(0, 3) }, { title: "Personales", color: "blue", items: weekItems.slice(3, 5) }].map((group) => <article className="panel" key={group.title}><header><span className={group.color}><Clock3 size={15} /></span><h3>{group.title}</h3><b>{group.items.length}</b></header>{group.items.map((item) => <div key={`${group.title}-${item.id}`}><span className={`demo-check ${item.done ? "done" : ""}`}>{item.done && <Check size={12} />}</span><span><b>{item.title}</b><small>{item.project} · {item.owner.name}</small></span><em>{item.due}</em></div>)}</article>)}</section></>}
      </div>
    </section>
  </main>;
}
