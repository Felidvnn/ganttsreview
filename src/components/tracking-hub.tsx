"use client";

import { CalendarDays, ClipboardCheck } from "lucide-react";
import { useCallback, useState } from "react";
import type { WeeklyItemData } from "@/lib/supabase/week-data";
import { GlobalFollowups, type TrackingProject } from "./global-followups";
import { WeeklyChecklist } from "./weekly-checklist";

export function TrackingHub({ initialItems, workspaceId, userId, weekStart, projects }: {
  initialItems: WeeklyItemData[];
  workspaceId: string | null;
  userId: string | null;
  weekStart: string;
  projects: TrackingProject[];
}) {
  const [tab, setTab] = useState<"week" | "pending">("week");
  const [weeklyItems, setWeeklyItems] = useState(initialItems);
  const handleWeeklyItemsChange = useCallback((items: WeeklyItemData[]) => setWeeklyItems(items), []);
  return <>
    <nav className="tracking-tabs" aria-label="Vistas de seguimiento">
      <button className={tab === "week" ? "active" : ""} onClick={() => setTab("week")}><CalendarDays size={16} /> Resumen semanal</button>
      <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}><ClipboardCheck size={16} /> Pendientes por proyecto</button>
    </nav>
    {tab === "week" ? <WeeklyChecklist initialItems={weeklyItems} workspaceId={workspaceId} userId={userId} weekStart={weekStart} onItemsChange={handleWeeklyItemsChange} /> : <GlobalFollowups projects={projects} weeklyItems={weeklyItems} weekStart={weekStart} />}
  </>;
}
