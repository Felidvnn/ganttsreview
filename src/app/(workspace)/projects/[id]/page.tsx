import Link from "next/link";
import { ArrowLeft, CalendarDays, Users } from "lucide-react";
import { notFound } from "next/navigation";
import { AvatarGroup } from "@/components/avatar";
import { ProjectWorkspace } from "@/components/project-workspace";
import { HealthBadge } from "@/components/status";
import { ProjectSharing } from "@/components/project-sharing";
import { ProjectRemoval } from "@/components/project-removal";
import { ProjectDetailsEditor } from "@/components/project-details-editor";
import { getProjectBundle } from "@/lib/supabase/data";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getProjectBundle(id);
  if (!bundle) notFound();
  const { project, tasks: displayTasks, canEdit, isOwner } = bundle;

  return (
    <div className="project-detail-page">
      <Link href="/projects" className="back-link"><ArrowLeft size={16} /> Proyectos</Link>
      <section className="project-detail-head">
        <div className="project-title-block"><span className="project-mark" style={{ background: project.color }}>{project.code.slice(0, 2)}</span><div><span className="project-code">{project.code}</span><h2>{project.name}</h2><div className="project-submeta"><HealthBadge health={project.health} /><span><CalendarDays size={14} /> {project.startLabel} — {project.dueLabel}</span><span><Users size={14} /> {project.members.length} integrantes</span></div></div></div>
        <div className="project-head-actions"><AvatarGroup people={project.members} max={4} />{canEdit && <ProjectDetailsEditor project={project} />}{isOwner && <ProjectSharing projectId={project.id} members={project.members} visibility={project.visibilityKey} showToLeader={Boolean(project.showToLeader)} />}<ProjectRemoval projectId={project.id} projectName={project.name} isOwner={isOwner} /></div>
      </section>

      <ProjectWorkspace project={project} initialTasks={displayTasks} canEdit={canEdit} />
    </div>
  );
}
