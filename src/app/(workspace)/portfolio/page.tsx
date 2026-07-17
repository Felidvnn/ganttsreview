import Link from "next/link";
import { AlertTriangle, ChevronDown, CircleCheckBig, Clock3, Network } from "lucide-react";
import { redirect } from "next/navigation";
import { AvatarGroup } from "@/components/avatar";
import { DependencyMap } from "@/components/dependency-map";
import { HealthBadge } from "@/components/status";
import { getProjects } from "@/lib/supabase/data";
import { getShellContext } from "@/lib/supabase/group-data";
import { getDependencyData } from "@/lib/supabase/dependency-data";

export default async function PortfolioPage() {
  const shell = await getShellContext();
  if (shell && shell.role !== "leader") redirect("/dashboard");
  const [projects, dependencies] = await Promise.all([
    getProjects(),
    getDependencyData(),
  ]);
  const globalProgress = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length) : 0;
  const openTasks = projects.reduce((sum, project) => sum + Math.max(0, project.tasksTotal - project.tasksDone), 0);
  const milestoneTotal = projects.reduce((sum, project) => sum + (project.milestonesTotal ?? 0), 0);
  const milestoneDone = projects.reduce((sum, project) => sum + (project.milestonesDone ?? 0), 0);
  const milestoneRate = milestoneTotal ? Math.round(milestoneDone / milestoneTotal * 100) : 0;
  const blockedTasks = projects.reduce((sum, project) => sum + (project.blockedTasks ?? 0), 0);
  const crossProjectDependencies = dependencies.filter((item) => item.predecessor.projectCode !== item.successor.projectCode).length;
  const progressBars = projects.length ? projects.map((project) => project.progress) : [0];
  return (
    <div className="portfolio-page">
      <section className="page-heading inline-heading"><div><span className="eyebrow">VISTA DE LÍDER</span><h2>Portafolio</h2><p>Una lectura completa del trabajo de tu equipo.</p></div></section>
      <section className="portfolio-hero">
        <div className="portfolio-score"><span>AVANCE GLOBAL</span><b>{globalProgress}<small>%</small></b><p><strong>{projects.length} proyectos</strong> activos en el espacio</p></div>
        <div className="portfolio-spark"><div className="spark-bars">{progressBars.map((value, index) => <i key={projects[index]?.id ?? index} style={{ height: `${Math.max(3, value)}%` }} title={projects[index] ? `${projects[index].name}: ${value}%` : "Sin proyectos"} />)}</div><span>PROYECTOS</span><span>AVANCE ACTUAL</span></div>
        <div className="portfolio-health"><div><CircleCheckBig /><span><b>{projects.filter((project) => project.health === "healthy").length}</b> En buen curso</span></div><div><Clock3 /><span><b>{projects.filter((project) => project.health === "risk").length}</b> En riesgo</span></div><div><AlertTriangle /><span><b>{projects.filter((project) => project.health === "delayed").length}</b> Con atraso</span></div></div>
      </section>
      <section className="portfolio-metrics metric-grid">
        <article className="metric-card"><div><small>PROYECTOS ACTIVOS</small><b>{projects.length}</b><p>visibles para tu rol</p></div></article>
        <article className="metric-card"><div><small>TAREAS ABIERTAS</small><b>{openTasks}</b><p>en todo el portafolio</p></div></article>
        <article className="metric-card"><div><small>CUMPLIMIENTO DE HITOS</small><b>{milestoneRate}%</b><p>{milestoneDone} de {milestoneTotal} completados</p></div></article>
        <article className="metric-card warning"><div><small>BLOQUEOS ACTIVOS</small><b>{blockedTasks}</b><p>{crossProjectDependencies} dependencias entre proyectos</p></div></article>
      </section>

      <section className="panel portfolio-table-panel">
        <div className="panel-head"><div><span className="eyebrow">PROYECTOS</span><h3>Estado del portafolio</h3></div></div>
        <div className="portfolio-table">
          <div className="portfolio-tr portfolio-th"><span>PROYECTO</span><span>AVANCE</span><span>DESVIACIÓN</span><span>EQUIPO</span><span>ESTADO</span><span>FECHA FIN</span><span /></div>
          {projects.map((project) => <Link href={`/projects/${project.id}`} className="portfolio-tr" key={project.id}><span className="portfolio-project"><i style={{ background: project.color }} /><span><b>{project.name}</b><small>{project.code}</small></span></span><span className="table-progress"><span><i style={{ width: `${project.progress}%`, background: project.color }} /></span><b>{project.progress}%</b></span><span className={project.progress >= project.expectedProgress ? "positive" : project.expectedProgress - project.progress > 10 ? "negative" : "neutral"}>{project.progress - project.expectedProgress > 0 ? "+" : ""}{project.progress - project.expectedProgress} pts</span><AvatarGroup people={project.members} max={3} /><HealthBadge health={project.health} /><span>{project.dueLabel}</span><ChevronDown size={16} /></Link>)}
        </div>
      </section>

      <section className="panel dependency-panel">
        <div className="panel-head"><div><span className="eyebrow"><Network size={13} /> DEPENDENCIAS TRANSVERSALES</span><h3>Cómo se conectan tus proyectos</h3><p>Detecta bloqueos antes de que se conviertan en atrasos.</p></div></div>
        <DependencyMap dependencies={dependencies} />
        {dependencies.length > 0 && <div className="dependency-alert"><Network size={17} /><span><b>{dependencies.length} relaciones activas.</b> Revisa el impacto antes de modificar fechas de tareas predecesoras.</span></div>}
      </section>
    </div>
  );
}
