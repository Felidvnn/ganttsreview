import Link from "next/link";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { AlertTriangle, ArrowRight, CalendarDays, Check, ChevronRight, Clock3, FolderKanban, ListChecks, TrendingUp, UserRoundCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressRing } from "@/components/progress-ring";
import { ProjectCard } from "@/components/project-card";
import { getProjects } from "@/lib/supabase/data";
import { getRecentActivity } from "@/lib/supabase/activity-data";
import { getShellContext, getTeamRoster } from "@/lib/supabase/group-data";
import { getWeekData } from "@/lib/supabase/week-data";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const [shell, params] = await Promise.all([getShellContext(), searchParams]);

  const isLeader = shell?.role === "leader";
  const [allProjects, week, allActivity, teamRoster] = await Promise.all([
    getProjects(),
    getWeekData(),
    getRecentActivity(30),
    getTeamRoster(isLeader ? shell.workspaceId : null),
  ]);
  const scope = isLeader && params.scope === "team" ? "team" : "mine";
  const isOwnedByCurrentUser = (project: (typeof allProjects)[number]) => Boolean(shell && (
    project.createdBy === shell.id
    || project.members.some((member) => member.id === shell.id && member.permission === "owner")
  ));
  const teamProjects = shell ? allProjects.filter((project) =>
    !isOwnedByCurrentUser(project)
    && project.workspaceId === shell.workspaceId
    && (project.visibilityKey === "shared" || project.visibilityKey === "workspace")
  ) : [];
  const teamProjectIds = new Set(teamProjects.map((project) => project.id));
  const personalProjects = shell ? allProjects.filter((project) =>
    isOwnedByCurrentUser(project)
    || (!teamProjectIds.has(project.id) && project.members.some((member) => member.id === shell.id))
  ) : allProjects;
  const projects = isLeader ? (scope === "team" ? teamProjects : personalProjects) : allProjects;
  const scopedProjectIds = new Set(projects.map((project) => project.id));
  const portfolioProgress = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length) : 0;
  const attentionCount = projects.filter((project) => project.health !== "healthy").length;
  const attentionProject = projects.find((project) => project.health === "delayed") ?? projects.find((project) => project.health === "risk");
  const now = new Date();
  const weekStartKey = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEndKey = format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weeklyItems = week.items.filter((item) => {
    const belongsToScope = scope === "team"
      ? item.source !== "personal" && Boolean(item.projectId && scopedProjectIds.has(item.projectId))
      : item.source === "personal" || Boolean(item.projectId && scopedProjectIds.has(item.projectId));
    const belongsToWeek = item.source === "personal" || item.done || item.overdue || Boolean(item.dueDate && item.dueDate >= weekStartKey && item.dueDate <= weekEndKey);
    return belongsToScope && belongsToWeek;
  });
  const focusItems = weeklyItems.filter((item) => !item.done).sort((left, right) => Number(Boolean(right.overdue)) - Number(Boolean(left.overdue)) || (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31"));
  const activity = allActivity.filter((item) => Boolean(item.projectId && scopedProjectIds.has(item.projectId))).slice(0, 4);
  const teamPeople = new Map<string, {
    id: string;
    name: string;
    initials: string;
    color: string;
    projects: Set<string>;
    pending: number;
    overdue: number;
    progressTotal: number;
    progressProjects: number;
    focus: Array<{ id: string; title: string; project: string; dueDate: string | null; overdue?: boolean }>;
  }>();
  if (scope === "team") {
    for (const person of teamRoster.filter((member) => member.id !== shell?.id)) {
      teamPeople.set(person.id, {
        id: person.id, name: person.name, initials: person.initials, color: person.color,
        projects: new Set<string>(), pending: 0, overdue: 0, progressTotal: 0, progressProjects: 0, focus: [],
      });
    }
    for (const project of teamProjects) {
      const owner = project.members.find((member) => member.id === project.createdBy)
        ?? project.members.find((member) => member.permission === "owner");
      const key = owner?.id || `project:${project.id}`;
      const current = teamPeople.get(key) ?? {
        id: key,
        name: owner?.name || "Sin responsable",
        initials: owner?.initials || "?",
        color: owner?.color || project.color,
        projects: new Set<string>(), pending: 0, overdue: 0, progressTotal: 0, progressProjects: 0, focus: [],
      };
      current.projects.add(project.id);
      current.progressTotal += project.progress;
      current.progressProjects += 1;
      teamPeople.set(key, current);
    }
    for (const item of weeklyItems.filter((entry) => !entry.done)) {
      const ownerName = item.owner || "Sin responsable";
      const existing = [...teamPeople.values()].find((person) => person.name === ownerName);
      const key = existing?.id || `owner:${ownerName.toLocaleLowerCase("es")}`;
      const current = existing ?? teamPeople.get(key) ?? {
        id: key,
        name: ownerName,
        initials: ownerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?",
        color: "#66847b",
        projects: new Set<string>(), pending: 0, overdue: 0, progressTotal: 0, progressProjects: 0, focus: [],
      };
      if (item.projectId) current.projects.add(item.projectId);
      current.pending += 1;
      if (item.overdue) current.overdue += 1;
      current.focus.push({ id: item.id, title: item.title, project: item.project, dueDate: item.dueDate, overdue: item.overdue });
      teamPeople.set(key, current);
    }
  }
  const teamSummary = [...teamPeople.values()].sort((left, right) => right.overdue - left.overdue || right.pending - left.pending || left.name.localeCompare(right.name, "es"));
  const dateLabel = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" }).format(now).toUpperCase();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(now));
  const greeting = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const firstName = shell?.name.split(/\s+/)[0] || "";
  return (
    <div className="dashboard-page">
      <section className="page-heading dashboard-heading">
        <div><span className="date-kicker">{dateLabel}</span><h2>{greeting}{firstName ? `, ${firstName}` : ""} <span>👋</span></h2><p>Este es el pulso de tus proyectos hoy.</p></div>
        <div className="dashboard-heading-actions"><Link href="/calendar" className="button secondary"><CalendarDays size={17} /> Calendario</Link><Link href="/week" className="button secondary"><ListChecks size={17} /> Seguimiento</Link></div>
      </section>
      {isLeader && <nav className="dashboard-scope-tabs" aria-label="Alcance del tablero"><Link className={scope === "mine" ? "active" : ""} href="/dashboard?scope=mine">Mis proyectos <span>{personalProjects.length}</span></Link><Link className={scope === "team" ? "active" : ""} href="/dashboard?scope=team">Equipo <span>{teamProjects.length}</span></Link></nav>}

      <section className="metric-grid">
        {scope === "team" ? <>
          <article className="metric-card"><span className="metric-icon green"><UserRoundCheck /></span><div><small>INGENIEROS MONITOREADOS</small><b>{teamSummary.length}</b><p>{teamSummary.filter((person) => person.projects.size > 0).length} con proyectos visibles</p></div></article>
          <article className="metric-card"><span className="metric-icon blue"><FolderKanban /></span><div><small>PROYECTOS DEL EQUIPO</small><b>{projects.length}</b><p><strong>{projects.filter((project) => project.health === "healthy").length}</strong> avanzan según lo esperado</p></div></article>
          <article className="metric-card warning"><span className="metric-icon amber"><AlertTriangle /></span><div><small>ATRASOS DEL EQUIPO</small><b>{weeklyItems.filter((item) => item.overdue && !item.done).length}</b><p>{attentionCount} proyectos requieren atención</p></div></article>
          <article className="metric-card"><span className="metric-icon violet"><TrendingUp /></span><div><small>AVANCE CONSOLIDADO</small><b>{portfolioProgress}%</b><p className="positive">Promedio de proyectos visibles</p></div></article>
        </> : <>
          <article className="metric-card"><span className="metric-icon green"><FolderKanban /></span><div><small>PROYECTOS ACTIVOS</small><b>{projects.length}</b><p><strong>{projects.filter((project) => project.health === "healthy").length}</strong> avanzan según lo esperado</p></div></article>
          <article className="metric-card"><span className="metric-icon blue"><Check /></span><div><small>COMPROMISOS ESTA SEMANA</small><b>{weeklyItems.length}</b><p><strong>{weeklyItems.filter((item) => item.done).length}</strong> completados · {weeklyItems.filter((item) => item.overdue && !item.done).length} atrasados</p></div><span className="mini-ring" style={{ "--mini": `${weeklyItems.length ? Math.round(weeklyItems.filter((item) => item.done).length / weeklyItems.length * 100) : 0}%` } as React.CSSProperties} /></article>
          <article className="metric-card warning"><span className="metric-icon amber"><AlertTriangle /></span><div><small>REQUIEREN ATENCIÓN</small><b>{attentionCount}</b><p>{projects.filter((project) => project.health === "delayed").length} con atraso · {projects.filter((project) => project.health === "risk").length} en riesgo</p></div><ChevronRight /></article>
          <article className="metric-card"><span className="metric-icon violet"><TrendingUp /></span><div><small>AVANCE DE TUS PROYECTOS</small><b>{portfolioProgress}%</b><p className="positive">Promedio de tu espacio personal</p></div></article>
        </>}
      </section>

      {scope === "team" && <section className="panel team-lead-panel">
        <div className="panel-head"><div><span className="eyebrow">VISTA DE JEFATURA</span><h3>Avance y compromisos por ingeniero</h3></div><Link href="/team">Administrar equipo <ArrowRight size={15} /></Link></div>
        {teamSummary.length ? <div className="team-member-list">{teamSummary.map((person) => {
          const average = person.progressProjects ? Math.round(person.progressTotal / person.progressProjects) : 0;
          const personProjects = teamProjects.filter((project) => person.projects.has(project.id));
          return <article className="team-member-row" key={person.id}>
            <header className="team-member-head"><Avatar person={{ id: person.id, name: person.name, initials: person.initials, role: "Ingeniero", color: person.color }} /><span className="team-member-copy"><b>{person.name}</b><small>{person.projects.size} {person.projects.size === 1 ? "proyecto visible" : "proyectos visibles"} · {person.pending} pendientes</small></span><span className={`team-member-alert ${person.overdue ? "late" : "clear"}`}>{person.overdue ? `${person.overdue} atrasada${person.overdue === 1 ? "" : "s"}` : "Al día"}</span></header>
            <div className="team-member-projects"><span className="team-card-label">PROYECTOS A CARGO</span>{personProjects.slice(0, 2).map((project) => { const projectPending = person.focus.filter((item) => item.project === project.name).length; return <Link href={`/projects/${project.id}`} key={project.id}><i style={{ background: project.color }} /><span><b>{project.name}</b><small>{projectPending ? `${projectPending} pendiente${projectPending === 1 ? "" : "s"} esta semana` : project.health === "healthy" ? "Avance dentro de lo esperado" : project.health === "risk" ? "Requiere seguimiento" : "Proyecto con atraso"}</small></span><strong>{project.progress}%</strong></Link>; })}{!personProjects.length && <span className="team-member-no-projects"><FolderKanban size={13} /> Sin proyectos visibles para jefatura</span>}{personProjects.length > 2 && <small className="team-member-more">+{personProjects.length - 2} proyectos adicionales</small>}</div>
            <div className="team-member-focus"><span className="team-card-label">PRÓXIMOS COMPROMISOS</span>{person.focus.slice(0, 2).map((item) => <span key={item.id}><i className={item.overdue ? "late" : ""} /><span><b>{item.title}</b><small>{item.project}{item.dueDate ? ` · ${item.dueDate}` : ""}</small></span></span>)}{!person.focus.length && <span className="team-member-no-focus"><Check size={12} /><em>Sin pendientes próximos</em></span>}{person.focus.length > 2 && <small className="team-member-more">+{person.focus.length - 2} pendientes adicionales</small>}</div>
            <footer className="team-member-foot"><span>Avance promedio</span><span className="team-member-progress"><i><em style={{ width: `${average}%`, background: person.color }} /></i><b>{average}%</b></span></footer>
          </article>;
        })}</div> : <div className="team-lead-empty"><UserRoundCheck size={21} /><span><b>Aún no hay proyectos del equipo para supervisar</b><small>Los proyectos privados de tus integrantes no aparecerán aquí.</small></span></div>}
      </section>}

      {scope !== "team" && <section className="dashboard-columns">
        <article className="panel focus-panel">
          <div className="panel-head"><div><span className="eyebrow">FOCO DE HOY</span><h3>Lo que necesita tu atención</h3></div><Link href="/week">Ver todo <ArrowRight size={15} /></Link></div>
          <div className="focus-list">
            {focusItems.slice(0, 4).map((item) => {
              const ownerName = item.owner || shell?.name || "Sin responsable";
              const ownerInitials = ownerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
              const projectColor = projects.find((project) => project.id === item.projectId)?.color ?? "#2f7669";
              return <div className="focus-row" key={item.id}>
                <span className="check-button" aria-hidden="true" />
                <div className="focus-copy"><b>{item.title}</b><span><i style={{ background: projectColor }} />{item.project}</span></div>
                <Avatar person={{ id: item.id, name: ownerName, initials: ownerInitials || "?", role: "Ingeniero", color: projectColor }} size="sm" />
                <span className="due-chip"><Clock3 size={13} />{item.overdue ? "Atrasada · " : ""}{item.dueDate || "Sin fecha"}</span>
              </div>;
            })}
            {!focusItems.length && <div className="dashboard-empty"><Check size={18} /><span><b>Tu semana está despejada</b><small>Agrega compromisos desde Seguimiento o Calendario.</small></span></div>}
          </div>
        </article>

        <article className="panel portfolio-pulse">
          <div className="panel-head"><div><span className="eyebrow">PORTAFOLIO</span><h3>Estado general</h3></div><Link href="/portfolio">Abrir consolidado <ArrowRight size={15} /></Link></div>
          <div className="pulse-main"><ProgressRing value={portfolioProgress} size={118} /><div><span><i className="dot healthy" />{projects.filter((project) => project.health === "healthy").length} en buen curso</span><span><i className="dot risk" />{projects.filter((project) => project.health === "risk").length} en riesgo</span><span><i className="dot delayed" />{projects.filter((project) => project.health === "delayed").length} con atraso</span></div></div>
          {attentionProject ? <div className="pulse-note"><AlertTriangle size={17} /><span><b>{attentionProject.name}</b> requiere una revisión del plan.</span><Link href={`/projects/${attentionProject.id}`}><ChevronRight size={18} /></Link></div> : <div className="pulse-note"><Check size={17} /><span>Todos los proyectos avanzan sin alertas relevantes.</span></div>}
        </article>
      </section>}

      <section className="section-block">
        <div className="section-title"><div><span className="eyebrow">EN MARCHA</span><h3>{scope === "team" ? "Proyectos del equipo" : "Tus proyectos"}</h3></div><Link href="/projects">Ver todos <ArrowRight size={16} /></Link></div>
        <div className="project-grid compact-grid">{projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} showOwner={scope === "team"} />)}</div>
        {!projects.length && <div className="dashboard-project-empty"><FolderKanban size={20} /><span><b>{scope === "team" ? "No hay proyectos compartidos con la jefatura" : "Todavía no tienes proyectos personales"}</b><small>{scope === "team" ? "Los proyectos privados permanecen exclusivamente en el inicio personal de cada integrante." : "Crea un proyecto para comenzar a planificar."}</small></span></div>}
      </section>

      <section className="panel recent-panel">
        <div className="panel-head"><div><span className="eyebrow">ACTIVIDAD</span><h3>{scope === "team" ? "Cambios recientes del equipo" : "Cambios recientes en tus proyectos"}</h3></div></div>
        <div className="activity-list">{activity.map((item, index) => <div key={item.id}><Avatar person={{ id: item.actorId, name: item.actorName, initials: item.actorName.split(/\s+/).slice(0,2).map((part) => part[0]).join(""), role: "Ingeniero", color: ["#245f55", "#7f5af0", "#e07a46"][index % 3] }} size="sm" /><span><b>{item.actorName}</b> {item.action === "update" ? "actualizó" : item.action === "insert" ? "creó" : "eliminó"} <strong>{item.entityTitle}</strong><small>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span></div>)}{!activity.length && <div className="dashboard-empty"><Clock3 size={18} /><span><b>Aún no hay actividad registrada</b><small>Los cambios de tareas aparecerán aquí.</small></span></div>}</div>
      </section>
    </div>
  );
}
