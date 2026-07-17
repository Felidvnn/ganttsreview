"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Project } from "@/lib/types";
import { ProjectCard } from "./project-card";
import { QuickCreate } from "./quick-create";

export function ProjectsView({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [createOpen, setCreateOpen] = useState(false);
  const filtered = useMemo(() => projects.filter((project) => {
    const matchesQuery = project.name.toLowerCase().includes(query.toLowerCase()) || project.code.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "Todos" || (filter === "En riesgo" && project.health !== "healthy") || project.visibility === filter;
    return matchesQuery && matchesFilter;
  }), [projects, query, filter]);

  return <>
    <section className="page-heading inline-heading"><div><span className="eyebrow">ESPACIO DE TRABAJO</span><h2>Proyectos</h2><p>{projects.length} proyectos activos · {projects.reduce((sum, item) => sum + Math.max(0, item.tasksTotal - item.tasksDone), 0)} tareas abiertas</p></div><button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nuevo proyecto</button></section>
    <div className="filter-bar"><div className="tab-filter">{["Todos", "Colaborativo", "Con líder", "Privado", "En riesgo"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}{item === "En riesgo" && <span>{projects.filter((project) => project.health !== "healthy").length}</span>}</button>)}</div><div className="filter-actions"><label className="small-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar proyecto" /></label></div></div>
    <div className="mobile-filter"><label className="small-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar proyecto" /></label></div>
    {filtered.length ? <div className="project-grid">{filtered.map((project) => <ProjectCard key={project.id} project={project} />)}</div> : <div className="empty-state"><Search /><h3>No encontramos proyectos</h3><p>Prueba con otro término o cambia los filtros.</p></div>}
    <QuickCreate open={createOpen} onClose={() => setCreateOpen(false)} />
  </>;
}
