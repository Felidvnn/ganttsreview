import type { ProjectHealth } from "@/lib/types";

export const PROJECT_RISK_GAP = 15;

export type ProjectMetricTask = {
  parentId?: string | null;
  status: string;
  progress?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
};

export type ProjectScheduleMetrics = {
  progress: number;
  expectedProgress: number;
  progressGap: number;
  health: ProjectHealth;
  hasBlockedTask: boolean;
  hasOverdueTask: boolean;
  projectOverdue: boolean;
};

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dateOnly(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function taskProgress(task: ProjectMetricTask) {
  if (task.status === "done") return 100;
  return clampProgress(task.progress ?? 0);
}

function expectedTaskProgress(task: ProjectMetricTask, today: Date) {
  const actual = taskProgress(task);
  const start = dateOnly(task.startDate);
  const due = dateOnly(task.dueDate);

  // An incomplete schedule should not create an artificial project risk.
  if (!due || (start && due < start)) return actual;
  if (task.isMilestone || !start || due.getTime() === start.getTime()) {
    return today >= due ? 100 : 0;
  }
  if (today <= start) return 0;
  if (today >= due) return 100;

  const elapsed = today.getTime() - start.getTime();
  const duration = due.getTime() - start.getTime();
  return clampProgress(elapsed / duration * 100);
}

export function calculateProjectScheduleMetrics({
  tasks,
  fallbackProgress = 0,
  projectDueDate,
  now = new Date(),
}: {
  tasks: ProjectMetricTask[];
  fallbackProgress?: number;
  projectDueDate?: string | null;
  now?: Date;
}): ProjectScheduleMetrics {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  // Parents already summarize their branches. Counting descendants again
  // would give large hierarchies more weight and disagree with the project view.
  const progressBasis = tasks.filter((task) => !task.parentId);
  const progress = progressBasis.length
    ? clampProgress(progressBasis.reduce((sum, task) => sum + taskProgress(task), 0) / progressBasis.length)
    : clampProgress(fallbackProgress);
  const expectedProgress = progressBasis.length
    ? clampProgress(progressBasis.reduce((sum, task) => sum + expectedTaskProgress(task, today), 0) / progressBasis.length)
    : progress;

  const hasOverdueTask = tasks.some((task) =>
    task.status !== "done"
    && taskProgress(task) < 100
    && Boolean(task.dueDate && task.dueDate < todayKey));
  const hasBlockedTask = tasks.some((task) => task.status === "blocked" && taskProgress(task) < 100);
  const projectOverdue = Boolean(projectDueDate && projectDueDate < todayKey && progress < 100);
  const progressGap = expectedProgress - progress;
  const health: ProjectHealth = hasOverdueTask || projectOverdue
    ? "delayed"
    : hasBlockedTask || progressGap >= PROJECT_RISK_GAP
      ? "risk"
      : "healthy";

  return {
    progress,
    expectedProgress,
    progressGap,
    health,
    hasBlockedTask,
    hasOverdueTask,
    projectOverdue,
  };
}
