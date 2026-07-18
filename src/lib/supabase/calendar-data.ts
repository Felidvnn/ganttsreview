import "server-only";
import { format } from "date-fns";
import { getProjects } from "./data";
import { createServerSupabaseClient } from "./server";

export type CalendarItemKind = "task" | "milestone" | "followup" | "personal";
export type CalendarItem = {
  id: string;
  title: string;
  kind: CalendarItemKind;
  date: string;
  startDate?: string | null;
  projectId?: string | null;
  projectName: string;
  projectCode?: string;
  projectColor: string;
  ownerId?: string | null;
  ownerName: string;
  done: boolean;
  overdue: boolean;
  priority: number;
  scope: "personal" | "team";
};

export type CalendarProjectOption = {
  id: string;
  workspaceId?: string;
  name: string;
  code: string;
  color: string;
  canEdit: boolean;
};

type JoinedProfile = { id: string; full_name: string };
type JoinedProject = { id: string; name: string; code: string; color: string; created_by: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function getCalendarData(): Promise<{
  items: CalendarItem[];
  projects: CalendarProjectOption[];
  userId: string | null;
  workspaceId: string | null;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { items: [], projects: [], userId: null, workspaceId: null };

  const [{ data: authData }, visibleProjects] = await Promise.all([
    supabase.auth.getUser(),
    getProjects(),
  ]);
  const user = authData.user;
  if (!user) return { items: [], projects: [], userId: null, workspaceId: null };

  const [membershipResult, tasksResult, followupsResult, personalResult] = await Promise.all([
    supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id).order("joined_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("tasks")
      .select("id,project_id,title,start_date,due_date,is_milestone,status,priority,manual_assignee,projects!tasks_project_id_fkey(id,name,code,color,created_by),task_assignees(user_id,profiles!task_assignees_user_id_fkey(id,full_name))")
      .not("due_date", "is", null).order("due_date").limit(2500),
    supabase.from("project_followups")
      .select("id,project_id,title,due_date,status,owner_label,created_by,projects!project_followups_project_id_fkey(id,name,code,color,created_by)")
      .not("due_date", "is", null).order("due_date").limit(1500),
    supabase.from("weekly_items")
      .select("id,title,due_date,completed_at,task_id").eq("user_id", user.id)
      .not("due_date", "is", null).order("due_date").limit(1500),
  ]);

  const today = format(new Date(), "yyyy-MM-dd");
  const tasks: CalendarItem[] = (tasksResult.data ?? []).map((row) => {
    const project = one(row.projects as unknown as JoinedProject | JoinedProject[] | null);
    const assignment = row.task_assignees?.[0];
    const profile = one(assignment?.profiles as unknown as JoinedProfile | JoinedProfile[] | null);
    const done = row.status === "done";
    return {
      id: `task:${row.id}`,
      title: row.title,
      kind: row.is_milestone ? "milestone" : "task",
      date: row.due_date!,
      startDate: row.start_date,
      projectId: row.project_id,
      projectName: project?.name ?? "Proyecto",
      projectCode: project?.code,
      projectColor: project?.color ?? "#2f7669",
      ownerId: assignment?.user_id ?? null,
      ownerName: profile?.full_name || row.manual_assignee || "Sin responsable",
      done,
      overdue: !done && row.due_date! < today,
      priority: row.priority ?? 2,
      scope: project?.created_by === user.id ? "personal" : "team",
    };
  });
  const followups: CalendarItem[] = (followupsResult.data ?? []).map((row) => {
    const project = one(row.projects as unknown as JoinedProject | JoinedProject[] | null);
    const done = row.status === "done";
    return {
      id: `followup:${row.id}`,
      title: row.title,
      kind: "followup",
      date: row.due_date!,
      projectId: row.project_id,
      projectName: project?.name ?? "Proyecto",
      projectCode: project?.code,
      projectColor: project?.color ?? "#b97825",
      ownerId: row.created_by === user.id ? user.id : null,
      ownerName: row.owner_label || "Sin responsable",
      done,
      overdue: !done && row.due_date! < today,
      priority: 2,
      scope: project?.created_by === user.id ? "personal" : "team",
    };
  });
  const personal: CalendarItem[] = (personalResult.data ?? []).map((row) => {
    const done = Boolean(row.completed_at);
    return {
      id: `personal:${row.id}`,
      title: row.title,
      kind: "personal",
      date: row.due_date!,
      projectName: "Personal",
      projectColor: "#5278a3",
      ownerId: user.id,
      ownerName: "Yo",
      done,
      overdue: !done && row.due_date! < today,
      priority: 2,
      scope: "personal",
    };
  });

  const projects = visibleProjects.map((project) => ({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    code: project.code,
    color: project.color,
    canEdit: project.createdBy === user.id || project.members.some((member) => member.id === user.id && (member.permission === "owner" || member.permission === "editor")),
  }));

  return {
    items: [...tasks, ...followups, ...personal],
    projects,
    userId: user.id,
    workspaceId: membershipResult.data?.workspace_id ?? null,
  };
}
