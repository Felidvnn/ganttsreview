import { CalendarRange } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { TrackingHub } from "@/components/tracking-hub";
import { getProjects } from "@/lib/supabase/data";
import { getShellContext } from "@/lib/supabase/group-data";
import { getWeekData } from "@/lib/supabase/week-data";

export default async function WeekPage() {
  const [data, projects, shell] = await Promise.all([getWeekData(), getProjects(), getShellContext()]);
  const rangeLabel = `${format(parseISO(data.weekStart), "d MMM", { locale: es })} — ${format(parseISO(data.weekEnd), "d MMM", { locale: es })}`;
  return (
    <div className="week-page">
      <section className="page-heading inline-heading"><div><span className="eyebrow">CONTROL SEMANAL</span><h2>Seguimiento</h2><p>Atrasos, tareas próximas, compromisos y pendientes personales, en un solo lugar.</p></div><div className="week-selector"><span className="week-range"><CalendarRange size={16} /> {rangeLabel}</span></div></section>
      <TrackingHub initialItems={data.items} workspaceId={data.workspaceId} userId={data.userId} weekStart={data.weekStart} projects={projects.map((project) => ({ id: project.id, name: project.name, code: project.code, color: project.color, canEdit: Boolean(shell && (project.createdBy === shell.id || project.members.some((member) => member.id === shell.id && (member.permission === "owner" || member.permission === "editor")))) }))} />
    </div>
  );
}
