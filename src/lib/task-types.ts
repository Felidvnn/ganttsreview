export type ProjectTaskType = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};

export const defaultProjectTaskTypes: ProjectTaskType[] = [
  { id: "task", name: "Tarea", color: "#47766A", sortOrder: 10 },
  { id: "process", name: "Proceso", color: "#3D78A3", sortOrder: 20 },
  { id: "meeting", name: "Reunión", color: "#8264A5", sortOrder: 30 },
  { id: "deliverable", name: "Entregable", color: "#B2763D", sortOrder: 40 },
  { id: "milestone", name: "Hito", color: "#B5504B", sortOrder: 50 },
];

export function taskTypeLabel(typeId: string | undefined, types: ProjectTaskType[], isMilestone = false) {
  return types.find((type) => type.id === typeId)?.name ?? (isMilestone ? "Hito" : "Tarea");
}
