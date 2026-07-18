import "server-only";
import { createServerSupabaseClient } from "./server";

export type ActivityEntry = {
  id: string;
  actorName: string;
  actorId: string;
  projectId: string | null;
  action: string;
  entityTitle: string;
  createdAt: string;
};

export async function getRecentActivity(limit = 5): Promise<ActivityEntry[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.from("audit_logs")
    .select("id,action,changes,created_at,actor_id,profiles!audit_logs_actor_id_fkey(id,full_name)")
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const changes = row.changes as {
      project_id?: string;
      after?: { title?: string; project_id?: string };
      before?: { project_id?: string };
      title?: string;
    } | null;
    return {
      id: String(row.id), actorName: profile?.full_name || "Integrante", actorId: row.actor_id || "",
      projectId: changes?.project_id || changes?.after?.project_id || changes?.before?.project_id || null,
      action: row.action, entityTitle: changes?.after?.title || changes?.title || "una tarea", createdAt: row.created_at,
    };
  });
}
