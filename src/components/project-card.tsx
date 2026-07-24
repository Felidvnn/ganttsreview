"use client";

import Link from "next/link";
import { CalendarDays, Crown, LockKeyhole, Users } from "lucide-react";
import type { Project } from "@/lib/types";
import { Avatar, AvatarGroup } from "./avatar";
import { HealthBadge } from "./status";

export function ProjectCard({ project, showOwner = false }: { project: Project; showOwner?: boolean }) {
  const owner = project.members.find((member) => member.id === project.createdBy)
    ?? project.members.find((member) => member.permission === "owner");

  return (
    <Link href={`/projects/${project.id}`} className="project-card">
      <div className="project-card-top">
        <span className="project-code" style={{ color: project.color }}>{project.code}</span>
        {showOwner && owner && <span className="team-project-owner"><Avatar person={owner} size="sm" /><span><small>RESPONSABLE</small><b>{owner.name}</b></span></span>}
      </div>
      <h3>{project.name}</h3><p>{project.description}</p>
      <div className="project-progress-head"><span>Avance</span><b>{project.progress}%</b></div>
      <div className="linear-progress"><i style={{ width: `${project.progress}%`, backgroundColor: project.color }} /></div>
      <div className="project-meta"><HealthBadge health={project.health} /><span><CalendarDays size={14} /> {project.dueLabel}</span></div>
      <div className="project-card-foot"><AvatarGroup people={project.members} /><span><i className={`project-visibility-icon ${project.visibilityKey === "workspace" && project.showToLeader ? "combined" : ""}`}>{project.visibilityKey === "private" ? <LockKeyhole /> : project.visibilityKey === "shared" ? <Crown /> : <><Users />{project.showToLeader && <Crown />}</>}</i>{project.visibilityKey === "workspace" && project.showToLeader ? "Colaborativo · Líder" : project.visibility}</span></div>
    </Link>
  );
}
