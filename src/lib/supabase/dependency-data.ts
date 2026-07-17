import "server-only";
import { createServerSupabaseClient } from "./server";

export type DependencyData = {
  id: string;
  type: string;
  predecessor: { id: string; title: string; status: string; projectName: string; projectCode: string };
  successor: { id: string; title: string; status: string; projectName: string; projectCode: string };
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getDependencyData(): Promise<DependencyData[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const fields = "id,dependency_type,predecessor:tasks!task_dependencies_predecessor_task_id_fkey(id,title,status,projects!tasks_project_id_fkey(id,name,code)),successor:tasks!task_dependencies_successor_task_id_fkey(id,title,status,projects!tasks_project_id_fkey(id,name,code))";
  const { data } = await supabase.from("task_dependencies").select(fields).order("created_at", { ascending: false }).limit(20);
  return (data ?? []).flatMap((row) => {
    const predecessor = one(row.predecessor as unknown as { id: string; title: string; status: string; projects: { name: string; code: string } | { name: string; code: string }[] | null } | null);
    const successor = one(row.successor as unknown as { id: string; title: string; status: string; projects: { name: string; code: string } | { name: string; code: string }[] | null } | null);
    if (!predecessor || !successor) return [];
    const predecessorProject = one(predecessor.projects);
    const successorProject = one(successor.projects);
    return [{
      id: row.id, type: row.dependency_type,
      predecessor: { id: predecessor.id, title: predecessor.title, status: predecessor.status, projectName: predecessorProject?.name ?? "Proyecto", projectCode: predecessorProject?.code ?? "" },
      successor: { id: successor.id, title: successor.title, status: successor.status, projectName: successorProject?.name ?? "Proyecto", projectCode: successorProject?.code ?? "" },
    }];
  });
}
