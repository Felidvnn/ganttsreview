import "server-only";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { people, projects as demoProjects, tasks as demoTasks } from "@/lib/demo-data";
import type { Person, Project, ProjectHealth, Task, TaskStatus } from "@/lib/types";
import { sortTasksByDate, sortTasksManual } from "@/lib/task-order";
import { hasSupabaseConfig } from "./client";
import { createServerSupabaseClient } from "./server";

type DbProfile = { id: string; full_name: string; email?: string | null; job_title?: string | null };
type DbMember = { user_id: string; permission?: "owner" | "editor" | "viewer"; profiles?: DbProfile | DbProfile[] | null };
type DbTaskCount = { id: string; status: string; progress: number; due_date: string | null; is_milestone: boolean };
type DbProject = {
  id: string; workspace_id: string; name: string; code: string; description: string; progress: number; health: string;
  due_date: string | null; start_date: string | null; color: string; visibility: string;
  created_by?: string;
  task_order_mode?: "date" | "manual";
  creator?: DbProfile | DbProfile[] | null; project_members?: DbMember[]; tasks?: DbTaskCount[];
};
type DbAssignee = { user_id?: string; profiles?: DbProfile | DbProfile[] | null };
type DbDirectoryAssignee = { assignee_id?: string; project_external_assignees?: { id: string; name: string } | { id: string; name: string }[] | null };
type DbTask = {
  id: string; project_id: string; parent_id?: string | null; title: string; description?: string; section: string; status: string; start_date: string | null;
  due_date: string | null; actual_completion_date?: string | null; progress: number; task_assignees?: DbAssignee[]; task_directory_assignees?: DbDirectoryAssignee[];
  is_milestone?: boolean; color?: string; manual_assignee?: string | null; rollup_progress?: boolean; priority?: number;
  task_type_id?: string | null; project_task_types?: { id: string; name: string; color: string } | { id: string; name: string; color: string }[] | null;
  sort_order?: number;
};

function oneProfile(value: DbProfile | DbProfile[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toPerson(profile: DbProfile | null | undefined, fallbackIndex = 0): Person {
  if (!profile) return { id: `unassigned-${fallbackIndex}`, name: "Sin asignar", initials: "—", role: "Ingeniero", color: "#98a6a0" };
  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return { id: profile.id, name: profile.full_name || "Integrante", initials, role: profile.job_title?.toLowerCase().includes("líder") ? "Líder" : "Ingeniero", color: people[fallbackIndex % people.length].color, email: profile.email ?? undefined };
}

function mapProject(row: DbProject): Project {
  const projectTasks = row.tasks ?? [];
  const creatorProfile = oneProfile(row.creator);
  const collaborators = row.visibility === "workspace" ? (row.project_members ?? []).map((member, index) => ({ ...toPerson(oneProfile(member.profiles), index + 1), permission: member.permission })) : [];
  const members = [
    ...(row.created_by && creatorProfile ? [{ ...toPerson(creatorProfile, 0), id: row.created_by, permission: "owner" as const }] : []),
    ...collaborators.filter((member) => member.id !== row.created_by),
  ];
  const visibilityKey = row.visibility === "workspace" ? "workspace" : row.visibility === "shared" ? "shared" : "private";
  const visibility: Project["visibility"] = visibilityKey === "private" ? "Privado" : visibilityKey === "shared" ? "Con líder" : "Colaborativo";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = row.start_date ? new Date(`${row.start_date}T12:00:00`) : null;
  const due = row.due_date ? new Date(`${row.due_date}T12:00:00`) : null;
  const progress = projectTasks.length ? Math.round(projectTasks.reduce((sum, task) => sum + (task.progress ?? (task.status === "done" ? 100 : 0)), 0) / projectTasks.length) : row.progress ?? 0;
  const expectedProgress = start && due
    ? today <= start ? 0 : today >= due ? 100 : Math.round((today.getTime() - start.getTime()) / Math.max(1, due.getTime() - start.getTime()) * 100)
    : progress;
  const hasOverdueTask = projectTasks.some((task) => task.status !== "done" && task.due_date && new Date(`${task.due_date}T23:59:59`) < today);
  const projectOverdue = Boolean(due && due < today && progress < 100);
  const health: ProjectHealth = hasOverdueTask || projectOverdue || row.health === "delayed" ? "delayed" : row.health === "risk" || expectedProgress - progress >= 10 ? "risk" : "healthy";
  const milestones = projectTasks.filter((task) => task.is_milestone);
  return {
    id: row.id, workspaceId: row.workspace_id, createdBy: row.created_by, name: row.name, code: row.code, description: row.description ?? "", progress,
    expectedProgress, health, dueLabel: due ? format(due, "dd MMM", { locale: es }) : "Sin fecha",
    dueDate: row.due_date ?? "", startDate: row.start_date ?? "", startLabel: start ? format(start, "dd MMM", { locale: es }) : "Sin fecha",
    color: row.color ?? "#2f7669", members, visibilityKey,
    tasksDone: projectTasks.filter((task) => task.status === "done").length, tasksTotal: projectTasks.length, visibility,
    milestonesDone: milestones.filter((task) => task.status === "done").length, milestonesTotal: milestones.length,
    blockedTasks: projectTasks.filter((task) => task.status === "blocked").length,
    taskOrderMode: row.task_order_mode ?? "date",
  };
}

export async function getProjects(): Promise<Project[]> {
  if (!hasSupabaseConfig) return demoProjects;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase!.from("projects").select("*, creator:profiles!projects_created_by_fkey(id,full_name,job_title), project_members(user_id,permission,profiles!project_members_user_id_fkey(id,full_name,job_title)), tasks(id,status,progress,due_date,is_milestone)").is("archived_at", null).order("updated_at", { ascending: false });
  if (error) throw new Error(`No se pudieron cargar los proyectos: ${error.message}`);
  return ((data ?? []) as unknown as DbProject[]).map(mapProject);
}

export async function getProjectBundle(id: string): Promise<{ project: Project; tasks: Task[]; canEdit: boolean; isOwner: boolean } | null> {
  if (!hasSupabaseConfig) {
    const project = demoProjects.find((item) => item.id === id);
    if (!project) return null;
    const projectTasks = demoTasks.filter((task) => task.projectId === id);
    return { project, tasks: projectTasks.length ? projectTasks : demoTasks.slice(0, 6).map((task) => ({ ...task, projectId: id })), canEdit: true, isOwner: true };
  }
  const supabase = await createServerSupabaseClient();
  const [projectResult, taskResult, sessionResult] = await Promise.all([
    supabase!.from("projects").select("*, creator:profiles!projects_created_by_fkey(id,full_name,job_title), project_members(user_id,permission,profiles!project_members_user_id_fkey(id,full_name,job_title)), tasks(id,status,progress,due_date,is_milestone)").eq("id", id).single(),
    supabase!.from("tasks").select("*, project_task_types!tasks_task_type_id_fkey(id,name,color), task_assignees(user_id,profiles!task_assignees_user_id_fkey(id, full_name, job_title)), task_directory_assignees(assignee_id,project_external_assignees!task_directory_assignees_assignee_id_fkey(id,name))").eq("project_id", id).order("sort_order"),
    supabase!.auth.getUser(),
  ]);
  const { data: projectData, error: projectError } = projectResult;
  if (projectError || !projectData) return null;
  const { data: taskData, error: taskError } = taskResult;
  if (taskError) throw new Error(`No se pudieron cargar las tareas: ${taskError.message}`);
  const project = mapProject(projectData as unknown as DbProject);
  const user = sessionResult.data.user;
  const rawProject = projectData as unknown as DbProject;
  const canEdit = Boolean(user && (rawProject.created_by === user.id || (rawProject.visibility === "workspace" && rawProject.project_members?.some((member) => member.user_id === user.id && (member.permission === "owner" || member.permission === "editor")))));
  const isOwner = Boolean(user && rawProject.created_by === user.id);
  const projectStart = projectData.start_date ? new Date(`${projectData.start_date}T12:00:00`) : new Date();
  const mappedTasks = ((taskData ?? []) as unknown as DbTask[]).map((row, index): Task => {
    const startDate = row.start_date ? new Date(`${row.start_date}T12:00:00`) : projectStart;
    const dueDate = row.due_date ? new Date(`${row.due_date}T12:00:00`) : startDate;
    const registeredOwners = (row.task_assignees ?? []).map((assignment, ownerIndex) => toPerson(oneProfile(assignment.profiles), index + ownerIndex)).filter((person) => !person.id.startsWith("unassigned-"));
    const directoryOwners: Person[] = (row.task_directory_assignees ?? []).flatMap((assignment) => {
      const entry = Array.isArray(assignment.project_external_assignees) ? assignment.project_external_assignees[0] : assignment.project_external_assignees;
      if (!entry) return [];
      return [{ id: `directory:${entry.id}`, directoryId: entry.id, name: entry.name, initials: entry.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?", role: "Ingeniero" as const, color: "#7c8c86" }];
    });
    const manualName = row.manual_assignee?.trim();
    const legacyManual = manualName && !directoryOwners.some((person) => person.name.toLowerCase() === manualName.toLowerCase())
      ? { id: `manual-${row.id}`, name: manualName, initials: manualName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(), role: "Ingeniero" as const, color: "#7c8c86" }
      : null;
    const owners = [...registeredOwners, ...directoryOwners, ...(legacyManual ? [legacyManual] : [])];
    const owner = owners[0] ?? toPerson(null, index);
    const taskType = Array.isArray(row.project_task_types) ? row.project_task_types[0] : row.project_task_types;
    return {
      id: row.id, projectId: row.project_id, parentId: row.parent_id ?? undefined, rollupProgress: Boolean(row.rollup_progress), title: row.title, description: row.description ?? "", section: row.section || "General",
      owner,
      start: Math.max(1, differenceInCalendarDays(startDate, projectStart) + 1),
      duration: Math.max(1, differenceInCalendarDays(dueDate, startDate) + 1), progress: row.progress ?? 0, priority: Math.min(3, Math.max(1, row.priority ?? 2)) as 1 | 2 | 3,
      status: row.status as TaskStatus, due: row.due_date ? format(dueDate, "dd MMM", { locale: es }) : "Sin fecha",
      dueDate: row.due_date ?? "", actualCompletionDate: row.actual_completion_date ?? "", isMilestone: Boolean(row.is_milestone),
      startDate: row.start_date ?? "", color: row.color ?? "#2f7669",
      owners, assigneeId: row.task_assignees?.[0]?.user_id, assigneeIds: row.task_assignees?.map((assignment) => assignment.user_id).filter((id): id is string => Boolean(id)), directoryAssigneeIds: row.task_directory_assignees?.map((assignment) => assignment.assignee_id).filter((id): id is string => Boolean(id)), manualAssignee: row.manual_assignee ?? undefined,
      taskTypeId: row.task_type_id ?? undefined, taskTypeName: taskType?.name, taskTypeColor: taskType?.color,
      sortOrder: row.sort_order,
      overdue: Boolean(row.due_date && dueDate < new Date() && row.status !== "done"),
    };
  });
  return { project, tasks: project.taskOrderMode === "manual" ? sortTasksManual(mappedTasks) : sortTasksByDate(mappedTasks), canEdit, isOwner };
}
