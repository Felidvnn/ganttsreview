import { differenceInCalendarDays, endOfWeek, format } from "date-fns";
import type { Task, TaskStatus } from "@/lib/types";

export type TaskDeadlineFilter = "all" | "overdue" | "due_this_week" | "no_date" | "completed";
export type TaskStatusFilter = "all" | TaskStatus;

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function taskDurationDays(task: Pick<Task, "startDate" | "dueDate" | "duration" | "isMilestone">) {
  if (task.isMilestone) return 1;
  if (!task.startDate || !task.dueDate) return Math.max(1, task.duration || 1);
  return Math.max(1, Math.abs(differenceInCalendarDays(
    new Date(`${task.dueDate}T12:00:00`),
    new Date(`${task.startDate}T12:00:00`),
  )) + 1);
}

export function taskOverdueDays(task: Pick<Task, "dueDate" | "status" | "progress">, now = new Date()) {
  if (!task.dueDate || task.status === "done" || task.progress >= 100) return 0;
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  const due = new Date(`${task.dueDate}T12:00:00`);
  return due < today ? differenceInCalendarDays(today, due) : 0;
}

export function taskMatchesFilters(
  task: Task,
  statusFilter: TaskStatusFilter,
  deadlineFilter: TaskDeadlineFilter,
  now = new Date(),
) {
  if (statusFilter !== "all" && task.status !== statusFilter) return false;
  if (deadlineFilter === "all") return true;

  const completed = task.status === "done" || task.progress >= 100;
  if (deadlineFilter === "completed") return completed;
  if (deadlineFilter === "no_date") return !task.dueDate;
  if (deadlineFilter === "overdue") return taskOverdueDays(task, now) > 0;
  if (!task.dueDate || completed) return false;

  const today = new Date(now); today.setHours(12, 0, 0, 0);
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  return task.dueDate >= dayKey(today) && task.dueDate <= dayKey(weekEnd);
}

export function filterProjectTasks(
  tasks: Task[],
  statusFilter: TaskStatusFilter,
  deadlineFilter: TaskDeadlineFilter,
  now = new Date(),
) {
  return tasks.filter((task) => taskMatchesFilters(task, statusFilter, deadlineFilter, now));
}
