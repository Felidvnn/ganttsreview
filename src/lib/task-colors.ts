import type { Task, TaskStatus } from "./types";

export type TaskColorMode = "manual" | "owner" | "section" | "status";

const palette = ["#2f7669", "#3778a6", "#7f5aa6", "#c07a32", "#b64e4e", "#567c8d", "#8a6b43", "#617c56"];
const statusColors: Record<TaskStatus, string> = { todo: "#829089", progress: "#3778a6", review: "#7f5aa6", blocked: "#b64e4e", done: "#2f7669" };

function stableIndex(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash) % palette.length;
}

export function taskDisplayColor(task: Task, mode: TaskColorMode) {
  if (mode === "status") return statusColors[task.status];
  if (mode === "owner") return palette[stableIndex(task.assigneeId || task.manualAssignee || "unassigned")];
  if (mode === "section") return palette[stableIndex(task.section || "General")];
  return task.color || palette[0];
}
