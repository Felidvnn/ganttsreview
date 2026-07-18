import "server-only";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { cache } from "react";
import { createServerSupabaseClient } from "./server";

export type GroupPerson = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  role: "leader" | "engineer";
  isAdmin: boolean;
  joinedAt: string;
};

export type GroupInvitation = {
  id: string;
  kind: "invitation" | "join_request";
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: string;
  workspace: { id: string; name: string };
  subject: { id: string; name: string; email: string };
  initiator: { id: string; name: string; email: string };
};

export type GroupData = {
  currentUser: { id: string; name: string; email: string } | null;
  group: { id: string; name: string; slug: string; createdBy: string } | null;
  membership: { role: "leader" | "engineer"; isAdmin: boolean } | null;
  members: GroupPerson[];
  invitations: GroupInvitation[];
  migrationRequired?: boolean;
};

type JoinedProfile = { id: string; full_name: string; email: string | null; job_title?: string | null };

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export const getGroupData = cache(async (): Promise<GroupData> => {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { currentUser: null, group: null, membership: null, members: [], invitations: [] };

  // The middleware already validates the token on protected routes. Reading the
  // session here avoids a second Auth network request during the same navigation.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { currentUser: null, group: null, membership: null, members: [], invitations: [] };

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles")
      .select("id,full_name,email,job_title").eq("id", user.id).maybeSingle(),
    supabase.from("workspace_members")
      .select("workspace_id,role,is_admin,joined_at,workspaces!workspace_members_workspace_id_fkey(id,name,slug,created_by)")
      .eq("user_id", user.id).order("joined_at").limit(1).maybeSingle(),
  ]);
  const { data: profile, error: profileError } = profileResult;
  if (profileError && profileError.message.includes("email")) {
    return { currentUser: { id: user.id, name: user.email?.split("@")[0] ?? "Usuario", email: user.email ?? "" }, group: null, membership: null, members: [], invitations: [], migrationRequired: true };
  }

  const currentUser = {
    id: user.id,
    name: profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario",
    email: profile?.email || user.email || "",
  };

  const { data: membershipRow, error: membershipError } = membershipResult;

  if (membershipError && membershipError.message.includes("is_admin")) {
    return { currentUser, group: null, membership: null, members: [], invitations: [], migrationRequired: true };
  }

  const workspace = one(membershipRow?.workspaces as unknown as { id: string; name: string; slug: string; created_by: string } | null);
  const group = workspace ? { id: workspace.id, name: workspace.name, slug: workspace.slug, createdBy: workspace.created_by } : null;
  const membership = membershipRow ? { role: membershipRow.role as "leader" | "engineer", isAdmin: Boolean(membershipRow.is_admin || membershipRow.role === "leader") } : null;

  // Keep the inbox clean before reading it. Older databases simply ignore the
  // missing RPC until migration 011 is applied.
  await supabase.rpc("expire_group_invitations", { target_workspace: group?.id ?? null });

  const membersQuery = group
    ? supabase.from("workspace_members")
      .select("user_id,role,is_admin,joined_at,profiles!workspace_members_user_id_fkey(id,full_name,email,job_title)")
      .eq("workspace_id", group.id).order("joined_at")
    : Promise.resolve({ data: [] });

  const invitationQuery = supabase.from("group_invitations")
    .select("id,kind,status,created_at,workspace:workspaces!group_invitations_workspace_id_fkey(id,name),subject:profiles!group_invitations_subject_user_id_fkey(id,full_name,email),initiator:profiles!group_invitations_initiated_by_fkey(id,full_name,email)")
    .eq("status", "pending").order("created_at", { ascending: false });

  const [membersResult, invitationsResult] = await Promise.all([
    membersQuery,
    group ? invitationQuery.or(`workspace_id.eq.${group.id},subject_user_id.eq.${user.id}`) : invitationQuery.eq("subject_user_id", user.id),
  ]);

  const members: GroupPerson[] = (membersResult.data ?? []).map((row) => {
      const memberProfile = one(row.profiles as unknown as JoinedProfile | JoinedProfile[] | null);
      return {
        id: row.user_id,
        name: memberProfile?.full_name || memberProfile?.email?.split("@")[0] || "Integrante",
        email: memberProfile?.email || "",
        jobTitle: memberProfile?.job_title || (row.role === "leader" ? "Líder de proyectos" : "Ingeniero"),
        role: row.role as "leader" | "engineer",
        isAdmin: Boolean(row.is_admin || row.role === "leader"),
        joinedAt: row.joined_at,
      };
    });

  const invitations: GroupInvitation[] = (invitationsResult.data ?? []).map((row) => {
    const subject = one(row.subject as unknown as JoinedProfile | JoinedProfile[] | null);
    const initiator = one(row.initiator as unknown as JoinedProfile | JoinedProfile[] | null);
    const invitationWorkspace = one(row.workspace as unknown as { id: string; name: string } | { id: string; name: string }[] | null);
    return {
      id: row.id,
      kind: row.kind as GroupInvitation["kind"],
      status: row.status as GroupInvitation["status"],
      createdAt: row.created_at,
      workspace: { id: invitationWorkspace?.id ?? "", name: invitationWorkspace?.name || "Grupo invitante" },
      subject: { id: subject?.id ?? "", name: subject?.full_name || subject?.email?.split("@")[0] || "Integrante", email: subject?.email || "" },
      initiator: { id: initiator?.id ?? "", name: initiator?.full_name || initiator?.email?.split("@")[0] || "Integrante", email: initiator?.email || "" },
    };
  });

  return { currentUser, group, membership, members, invitations };
});

export const getShellContext = cache(async () => {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  // The shell only needs four small fields. Do not load the complete member list
  // and all pending invitations on every page transition.
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const [membershipResult, personalResult, tasksResult, followupsResult, invitationsResult] = await Promise.all([
    supabase.from("workspace_members")
      .select("workspace_id,role,is_admin,profiles!workspace_members_user_id_fkey(full_name),workspaces!workspace_members_workspace_id_fkey(name)")
      .eq("user_id", user.id).order("joined_at").limit(1).maybeSingle(),
    supabase.from("weekly_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("week_start", weekStart).is("completed_at", null),
    supabase.from("tasks")
      .select("id", { count: "exact", head: true })
      .neq("status", "done").not("due_date", "is", null).lte("due_date", weekEnd),
    supabase.from("project_followups")
      .select("id", { count: "exact", head: true })
      .neq("status", "done").not("due_date", "is", null).lte("due_date", weekEnd),
    supabase.from("group_invitations")
      .select("id", { count: "exact", head: true })
      .eq("subject_user_id", user.id)
      .eq("kind", "invitation")
      .eq("status", "pending")
      .gte("expires_at", new Date().toISOString()),
  ]);
  const membershipRow = membershipResult.data;

  const profile = one(membershipRow?.profiles as unknown as { full_name: string } | { full_name: string }[] | null);
  const workspace = one(membershipRow?.workspaces as unknown as { name: string } | { name: string }[] | null);
  const name: string = profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "U";
  return {
    id: user.id,
    name,
    initials,
    workspaceId: membershipRow?.workspace_id ?? null,
    hasGroup: Boolean(membershipRow?.workspace_id),
    role: (membershipRow?.role ?? "engineer") as "leader" | "engineer",
    isAdmin: Boolean(membershipRow?.is_admin || membershipRow?.role === "leader"),
    groupName: workspace?.name ?? "Sin grupo",
    weekPendingCount: (personalResult.count ?? 0) + (tasksResult.count ?? 0) + (followupsResult.count ?? 0),
    groupInvitationCount: invitationsResult.count ?? 0,
  };
});

export async function getTeamRoster(workspaceId: string | null) {
  if (!workspaceId) return [] as Array<{ id: string; name: string; initials: string; color: string; role: "leader" | "engineer" }>;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("workspace_members")
    .select("user_id,role,profiles!workspace_members_user_id_fkey(full_name)")
    .eq("workspace_id", workspaceId)
    .order("joined_at");
  const colors = ["#2f7669", "#5278a3", "#8a6cab", "#b27048", "#557f78", "#9b6a52"];
  return (data ?? []).map((row, index) => {
    const profile = one(row.profiles as unknown as { full_name: string } | { full_name: string }[] | null);
    const name = profile?.full_name || "Integrante";
    return {
      id: row.user_id,
      name,
      initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?",
      color: colors[index % colors.length],
      role: row.role as "leader" | "engineer",
    };
  });
}
