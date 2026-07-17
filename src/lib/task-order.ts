import type { Task } from "./types";

export function taskDateKey(task: Task) {
  return task.startDate || task.dueDate || "9999-12-31";
}

function compareTasks(left: Task, right: Task) {
  const date = taskDateKey(left).localeCompare(taskDateKey(right));
  if (date) return date;
  const due = (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31");
  if (due) return due;
  return left.title.localeCompare(right.title, "es", { sensitivity: "base" });
}

// Dates order siblings, never generations. A child is always emitted immediately
// after its parent (and after older siblings), regardless of its own schedule.
export function sortTasksByDate(tasks: Task[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    if (task.parentId && byId.has(task.parentId)) {
      const siblings = children.get(task.parentId) ?? [];
      siblings.push(task); children.set(task.parentId, siblings);
    } else roots.push(task);
  }

  const ordered: Task[] = [];
  const visited = new Set<string>();
  const visit = (task: Task) => {
    if (visited.has(task.id)) return;
    visited.add(task.id); ordered.push(task);
    [...(children.get(task.id) ?? [])].sort(compareTasks).forEach(visit);
  };
  [...roots].sort(compareTasks).forEach(visit);
  [...tasks].filter((task) => !visited.has(task.id)).sort(compareTasks).forEach(visit);
  return ordered;
}

export function taskDisplaySection(task: Task, tasks: Task[]) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  let current = task;
  const visited = new Set<string>();
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.section || task.section || "General";
}

export function taskHierarchyPath(task: Task, tasks: Task[]) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const path = [task.title];
  let parentId = task.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent.title); parentId = parent.parentId;
  }
  return path.join(" > ");
}

export function taskDepth(task: Task, tasks: Task[]) {
  let depth = 0;
  let parentId = task.parentId;
  const visited = new Set<string>();
  while (parentId && depth < 10 && !visited.has(parentId)) {
    visited.add(parentId); depth += 1;
    parentId = tasks.find((item) => item.id === parentId)?.parentId;
  }
  return depth;
}

export function applyTaskRollups(tasks: Task[]) {
  const result = tasks.map((task) => ({ ...task }));
  [...result].sort((left, right) => taskDepth(right, result) - taskDepth(left, result)).forEach((task) => {
    if (!task.rollupProgress) return;
    const children = result.filter((item) => item.parentId === task.id);
    if (!children.length) return;
    const progress = Math.round(children.reduce((sum, child) => sum + child.progress, 0) / children.length);
    task.progress = progress;
    task.status = progress === 100 ? "done" : task.status === "done" ? "progress" : task.status;
  });
  return sortTasksByDate(result);
}
