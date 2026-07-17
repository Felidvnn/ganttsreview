import "server-only";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { createServerSupabaseClient } from "./server";

export type WeeklyItemData = {
  id: string;
  title: string;
  project: string;
  dueDate: string | null;
  done: boolean;
  taskId: string | null;
  source: "personal" | "task" | "followup";
  priority?: number;
  overdue?: boolean;
  projectId?: string | null;
  parentTitle?: string | null;
  owner?: string | null;
  isBlocker?: boolean;
};

export async function getWeekData() {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const range = { weekStart: format(weekStart, "yyyy-MM-dd"), weekEnd: format(weekEnd, "yyyy-MM-dd") };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { items: [] as WeeklyItemData[], workspaceId: null, userId: null, ...range };
  // Auth is validated in middleware; use the cookie session to avoid another
  // remote Auth request while rendering the page.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { items: [] as WeeklyItemData[], workspaceId: null, userId: null, ...range };
  const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return { items: [] as WeeklyItemData[], workspaceId: null, userId: user.id, ...range };
  const [weeklyResult, tasksResult, followupsResult] = await Promise.all([
    supabase.from("weekly_items")
      .select("id,title,due_date,completed_at,task_id,tasks(projects(name))")
      .eq("user_id", user.id).eq("week_start", format(weekStart, "yyyy-MM-dd"))
      .order("completed_at", { ascending: true, nullsFirst: true }).order("due_date", { ascending: true }),
    supabase.from("tasks")
      .select("id,project_id,parent_id,title,due_date,status,progress,priority,completed_at,manual_assignee,projects!tasks_project_id_fkey(name),task_assignees(user_id,profiles!task_assignees_user_id_fkey(full_name))")
      .order("due_date", { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from("project_followups")
      .select("id,project_id,task_id,title,due_date,status,is_blocker,owner_label,projects!project_followups_project_id_fkey(name)")
      .neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }).limit(1000),
  ]);
  const personalItems: WeeklyItemData[] = (weeklyResult.data ?? []).map((row) => {
    const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
    const project = task && (Array.isArray(task.projects) ? task.projects[0] : task.projects);
    return { id: row.id, title: row.title, project: project?.name ?? "Pendiente personal", dueDate: row.due_date, done: Boolean(row.completed_at), taskId: row.task_id, source: "personal" };
  });
  const linkedTaskIds = new Set(personalItems.map((item) => item.taskId).filter(Boolean));
  const weekStartKey = format(weekStart, "yyyy-MM-dd");
  const weekEndKey = format(weekEnd, "yyyy-MM-dd");
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const rawTasks = tasksResult.data ?? [];
  const taskById = new Map(rawTasks.map((task) => [task.id, task]));
  const rootTitle = (task: (typeof rawTasks)[number]) => {
    let current = task; const visited = new Set<string>();
    while (current.parent_id && !visited.has(current.parent_id)) {
      visited.add(current.parent_id);
      const parent = taskById.get(current.parent_id);
      if (!parent) break;
      current = parent;
    }
    return current.id === task.id ? null : current.title;
  };
  const taskItems: WeeklyItemData[] = (tasksResult.data ?? []).filter((row) => {
    if (linkedTaskIds.has(row.id)) return false;
    if (row.status !== "done") return true;
    const completedKey = row.completed_at?.slice(0, 10);
    return Boolean(completedKey && completedKey >= weekStartKey && completedKey <= weekEndKey);
  }).map((row) => {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    const assignment = row.task_assignees?.[0];
    const profile = assignment && (Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles);
    return {
      id: `task:${row.id}`, taskId: row.id, source: "task" as const, projectId: row.project_id,
      title: row.title, project: project?.name ?? "Proyecto", dueDate: row.due_date,
      done: row.status === "done", priority: row.priority ?? 2,
      overdue: Boolean(row.status !== "done" && row.due_date && row.due_date < todayKey),
      parentTitle: rootTitle(row), owner: profile?.full_name || row.manual_assignee || "Sin responsable",
    };
  });
  const followupItems: WeeklyItemData[] = (followupsResult.data ?? []).map((row) => {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: `followup:${row.id}`, taskId: row.task_id, source: "followup" as const, projectId: row.project_id,
      title: row.title, project: project?.name ?? "Proyecto", dueDate: row.due_date, done: false,
      overdue: Boolean(row.due_date && row.due_date < todayKey), owner: row.owner_label || "Sin responsable", isBlocker: row.is_blocker,
    };
  });
  const items = [...personalItems, ...taskItems, ...followupItems].sort((left, right) => Number(left.done) - Number(right.done) || Number(Boolean(right.overdue)) - Number(Boolean(left.overdue)) || (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31"));
  return { items, workspaceId: membership.workspace_id, userId: user.id, ...range };
}
