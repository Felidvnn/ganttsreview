import { differenceInCalendarDays } from "date-fns";
import type { Task } from "@/lib/types";

export type TaskDelayMetrics = {
  currentByTask: Map<string, number>;
  delayedTaskIds: Set<string>;
  representativeTaskIds: Set<string>;
  summaryTaskIds: Set<string>;
  maximumDelayDays: number;
  affectedTaskCount: number;
  taskDays: number;
};

export function taskCurrentDelayDays(task: Pick<Task, "dueDate" | "actualCompletionDate" | "status">, now = new Date()) {
  if (!task.dueDate) return 0;
  const due = new Date(`${task.dueDate}T12:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const reference = task.actualCompletionDate
    ? new Date(`${task.actualCompletionDate}T12:00:00`)
    : task.status === "done" ? due : new Date(now);
  reference.setHours(12, 0, 0, 0);
  return Number.isNaN(reference.getTime()) ? 0 : Math.max(0, differenceInCalendarDays(reference, due));
}

export function calculateTaskDelayMetrics(tasks: Task[], now = new Date()): TaskDelayMetrics {
  const currentByTask = new Map(tasks.map((task) => [task.id, taskCurrentDelayDays(task, now)]));
  const delayedTaskIds = new Set(tasks.filter((task) => (currentByTask.get(task.id) ?? 0) > 0).map((task) => task.id));
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    children.set(task.parentId, [...(children.get(task.parentId) ?? []), task.id]);
  }

  const delayedDescendantMemo = new Map<string, boolean>();
  const hasDelayedDescendant = (taskId: string, visiting = new Set<string>()): boolean => {
    const cached = delayedDescendantMemo.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return false;
    const nextVisiting = new Set(visiting); nextVisiting.add(taskId);
    const result = (children.get(taskId) ?? []).some((childId) => delayedTaskIds.has(childId) || hasDelayedDescendant(childId, nextVisiting));
    delayedDescendantMemo.set(taskId, result);
    return result;
  };

  const representativeTaskIds = new Set<string>();
  const summaryTaskIds = new Set<string>();
  for (const taskId of delayedTaskIds) {
    if (hasDelayedDescendant(taskId)) summaryTaskIds.add(taskId);
    else representativeTaskIds.add(taskId);
  }

  const representativeDelays = [...representativeTaskIds].map((taskId) => currentByTask.get(taskId) ?? 0);
  return {
    currentByTask,
    delayedTaskIds,
    representativeTaskIds,
    summaryTaskIds,
    maximumDelayDays: Math.max(0, ...[...delayedTaskIds].map((taskId) => currentByTask.get(taskId) ?? 0)),
    affectedTaskCount: representativeTaskIds.size,
    taskDays: representativeDelays.reduce((sum, days) => sum + days, 0),
  };
}
