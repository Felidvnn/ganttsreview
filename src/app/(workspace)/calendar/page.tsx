import { CalendarDays } from "lucide-react";
import { CalendarWorkspace } from "@/components/calendar-workspace";
import { getCalendarData } from "@/lib/supabase/calendar-data";

export default async function CalendarPage() {
  const data = await getCalendarData();
  return (
    <div className="calendar-page">
      <section className="page-heading inline-heading calendar-heading">
        <div><span className="eyebrow">PLANIFICACIÓN TRANSVERSAL</span><h2>Calendario</h2><p>Tareas, hitos, seguimientos y pendientes personales de todos tus proyectos.</p></div>
        <span className="calendar-heading-icon"><CalendarDays size={22} /></span>
      </section>
      <CalendarWorkspace initialItems={data.items} projects={data.projects} userId={data.userId} workspaceId={data.workspaceId} />
    </div>
  );
}
