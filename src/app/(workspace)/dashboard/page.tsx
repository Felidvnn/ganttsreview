import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock3, FolderKanban, ListChecks, TrendingUp } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressRing } from "@/components/progress-ring";
import { ProjectCard } from "@/components/project-card";
import { getProjects } from "@/lib/supabase/data";
import { getRecentActivity } from "@/lib/supabase/activity-data";
import { getShellContext } from "@/lib/supabase/group-data";
import { getWeekData } from "@/lib/supabase/week-data";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const [shell, params] = await Promise.all([getShellContext(), searchParams]);
  if (shell && !shell.hasGroup) redirect("/team");

  const [allProjects, week, activity] = await Promise.all([
    getProjects(),
    getWeekData(),
    getRecentActivity(4),
  ]);
  const isLeader = shell?.role === "leader";
  const scope = isLeader && params.scope === "team" ? "team" : "mine";
  const projects = scope === "team" ? allProjects : allProjects.filter((project) => !shell || project.createdBy === shell.id);
  const portfolioProgress = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length) : 0;
  const attentionCount = projects.filter((project) => project.health !== "healthy").length;
  const attentionProject = projects.find((project) => project.health === "delayed") ?? projects.find((project) => project.health === "risk");
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).format(now).toUpperCase();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(now));
  const greeting = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const firstName = shell?.name.split(/\s+/)[0] || "";
  return (
    <div className="dashboard-page">
      <section className="page-heading dashboard-heading">
        <div><span className="date-kicker">{dateLabel}</span><h2>{greeting}{firstName ? `, ${firstName}` : ""} <span>👋</span></h2><p>Este es el pulso de tus proyectos hoy.</p></div>
        <Link href="/week" className="button secondary"><ListChecks size={17} /> Abrir seguimiento</Link>
      </section>
      {isLeader && <nav className="dashboard-scope-tabs" aria-label="Alcance del tablero"><Link className={scope === "mine" ? "active" : ""} href="/dashboard?scope=mine">Lo mío</Link><Link className={scope === "team" ? "active" : ""} href="/dashboard?scope=team">Mi equipo <span>{allProjects.length}</span></Link></nav>}

      <section className="metric-grid">
        <article className="metric-card"><span className="metric-icon green"><FolderKanban /></span><div><small>PROYECTOS ACTIVOS</small><b>{projects.length}</b><p><strong>{projects.filter((project) => project.health === "healthy").length}</strong> avanzan según lo esperado</p></div></article>
        <article className="metric-card"><span className="metric-icon blue"><Check /></span><div><small>COMPROMISOS ESTA SEMANA</small><b>{week.items.length}</b><p><strong>{week.items.filter((item) => item.done).length}</strong> completados</p></div><span className="mini-ring" style={{ "--mini": `${week.items.length ? Math.round(week.items.filter((item) => item.done).length / week.items.length * 100) : 0}%` } as React.CSSProperties} /></article>
        <article className="metric-card warning"><span className="metric-icon amber"><AlertTriangle /></span><div><small>REQUIEREN ATENCIÓN</small><b>{attentionCount}</b><p>{projects.filter((project) => project.health === "delayed").length} con atraso · {projects.filter((project) => project.health === "risk").length} en riesgo</p></div><ChevronRight /></article>
        <article className="metric-card"><span className="metric-icon violet"><TrendingUp /></span><div><small>AVANCE DEL PORTAFOLIO</small><b>{portfolioProgress}%</b><p className="positive">Visión consolidada del equipo</p></div></article>
      </section>

      <section className="dashboard-columns">
        <article className="panel focus-panel">
          <div className="panel-head"><div><span className="eyebrow">FOCO DE HOY</span><h3>Lo que necesita tu atención</h3></div><Link href="/week">Ver todo <ArrowRight size={15} /></Link></div>
          <div className="focus-list">
            {week.items.slice(0, 4).map((item, index) => (
              <div className={`focus-row ${item.done ? "done" : ""}`} key={item.id}>
                <span className="check-button" aria-hidden="true">{item.done && <Check size={14} />}</span>
                <div className="focus-copy"><b>{item.title}</b><span><i style={{ background: projects[index % Math.max(1, projects.length)]?.color ?? "#2f7669" }} />{item.project}</span></div>
                {shell && <Avatar person={{ id: shell.id, name: shell.name, initials: shell.initials, role: shell.role === "leader" ? "Líder" : "Ingeniero", color: "#245f55" }} size="sm" />}
                <span className="due-chip"><Clock3 size={13} />{item.dueDate || "Sin fecha"}</span>
              </div>
            ))}
            {!week.items.length && <div className="dashboard-empty"><Check size={18} /><span><b>Tu semana está despejada</b><small>Agrega compromisos desde Seguimiento.</small></span></div>}
          </div>
        </article>

        <article className="panel portfolio-pulse">
          <div className="panel-head"><div><span className="eyebrow">PORTAFOLIO</span><h3>Estado general</h3></div><Link href="/portfolio">Abrir consolidado <ArrowRight size={15} /></Link></div>
          <div className="pulse-main"><ProgressRing value={portfolioProgress} size={118} /><div><span><i className="dot healthy" />{projects.filter((project) => project.health === "healthy").length} en buen curso</span><span><i className="dot risk" />{projects.filter((project) => project.health === "risk").length} en riesgo</span><span><i className="dot delayed" />{projects.filter((project) => project.health === "delayed").length} con atraso</span></div></div>
          {attentionProject ? <div className="pulse-note"><AlertTriangle size={17} /><span><b>{attentionProject.name}</b> requiere una revisión del plan.</span><Link href={`/projects/${attentionProject.id}`}><ChevronRight size={18} /></Link></div> : <div className="pulse-note"><Check size={17} /><span>Todos los proyectos avanzan sin alertas relevantes.</span></div>}
        </article>
      </section>

      <section className="section-block">
        <div className="section-title"><div><span className="eyebrow">EN MARCHA</span><h3>Tus proyectos</h3></div><Link href="/projects">Ver todos <ArrowRight size={16} /></Link></div>
        <div className="project-grid compact-grid">{projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} />)}</div>
      </section>

      <section className="panel recent-panel">
        <div className="panel-head"><div><span className="eyebrow">ACTIVIDAD</span><h3>Cambios recientes</h3></div></div>
        <div className="activity-list">{activity.map((item, index) => <div key={item.id}><Avatar person={{ id: item.actorId, name: item.actorName, initials: item.actorName.split(/\s+/).slice(0,2).map((part) => part[0]).join(""), role: "Ingeniero", color: ["#245f55", "#7f5af0", "#e07a46"][index % 3] }} size="sm" /><span><b>{item.actorName}</b> {item.action === "update" ? "actualizó" : item.action === "insert" ? "creó" : "eliminó"} <strong>{item.entityTitle}</strong><small>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span></div>)}{!activity.length && <div className="dashboard-empty"><Clock3 size={18} /><span><b>Aún no hay actividad registrada</b><small>Los cambios de tareas aparecerán aquí.</small></span></div>}</div>
      </section>
    </div>
  );
}
