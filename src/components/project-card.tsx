"use client";

import Link from "next/link";
import { CalendarDays, Crown, LockKeyhole, Users } from "lucide-react";
import type { Project } from "@/lib/types";
import { AvatarGroup } from "./avatar";
import { HealthBadge } from "./status";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`} className="project-card">
      <div className="project-card-top"><span className="project-code" style={{ color: project.color }}>{project.code}</span></div>
      <h3>{project.name}</h3><p>{project.description}</p>
      <div className="project-progress-head"><span>Avance</span><b>{project.progress}%</b></div>
      <div className="linear-progress"><i style={{ width: `${project.progress}%`, backgroundColor: project.color }} /></div>
      <div className="project-meta"><HealthBadge health={project.health} /><span><CalendarDays size={14} /> {project.dueLabel}</span></div>
      <div className="project-card-foot"><AvatarGroup people={project.members} /><span>{project.visibilityKey === "private" ? <LockKeyhole size={14} /> : project.visibilityKey === "shared" ? <Crown size={14} /> : <Users size={14} />}{project.visibility}</span></div>
    </Link>
  );
}
