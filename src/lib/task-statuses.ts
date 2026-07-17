import type { TaskStatus } from "./types";

export type ProjectTaskStatus = {
  status: TaskStatus;
  label: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
};

export const defaultProjectStatuses: ProjectTaskStatus[] = [
  { status: "todo", label: "Pendiente", color: "#7A8781", enabled: true, sortOrder: 10 },
  { status: "progress", label: "En curso", color: "#3778A6", enabled: true, sortOrder: 20 },
  { status: "review", label: "En revisión", color: "#7F5AA6", enabled: true, sortOrder: 30 },
  { status: "blocked", label: "Bloqueada", color: "#B64E4E", enabled: true, sortOrder: 40 },
  { status: "done", label: "Completada", color: "#2F7669", enabled: true, sortOrder: 50 },
];

export function statusLabel(status: TaskStatus, options: ProjectTaskStatus[]) {
  return options.find((item) => item.status === status)?.label ?? defaultProjectStatuses.find((item) => item.status === status)!.label;
}
