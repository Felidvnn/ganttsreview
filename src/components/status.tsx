import type { ProjectHealth, TaskStatus } from "@/lib/types";

const healthLabels: Record<ProjectHealth, string> = { healthy: "En buen curso", risk: "En riesgo", delayed: "Con atraso" };
const taskLabels: Record<TaskStatus, string> = { todo: "Por hacer", progress: "En curso", review: "En revisión", done: "Completada", blocked: "Bloqueada" };

export function HealthBadge({ health }: { health: ProjectHealth }) {
  return <span className={`status-pill health-${health}`}><i />{healthLabels[health]}</span>;
}

export function TaskBadge({ status, label, color }: { status: TaskStatus; label?: string; color?: string }) {
  return <span className={`task-status status-${status}`} style={color ? { color, backgroundColor: `${color}18` } : undefined}>{label ?? taskLabels[status]}</span>;
}
