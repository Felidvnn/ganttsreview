import type { Person, Project, Task } from "./types";

export const people: Person[] = [
  { id: "p1", name: "Felipe Marín", initials: "FM", role: "Líder", color: "#245f55" },
  { id: "p2", name: "Camila Soto", initials: "CS", role: "Ingeniero", color: "#7f5af0" },
  { id: "p3", name: "Diego Rojas", initials: "DR", role: "Ingeniero", color: "#e07a46" },
  { id: "p4", name: "Antonia Silva", initials: "AS", role: "Ingeniero", color: "#2676c7" },
  { id: "p5", name: "Martín Lagos", initials: "ML", role: "Ingeniero", color: "#b55c88" },
];

export const projects: Project[] = [
  {
    id: "planta-norte", name: "Expansión Planta Norte", code: "EPN-24", description: "Ampliación de capacidad y puesta en marcha de nueva línea.",
    progress: 68, expectedProgress: 72, health: "risk", dueLabel: "28 ago", dueDate: "2026-08-28", color: "#a56a22",
    members: [people[0], people[1], people[2]], tasksDone: 24, tasksTotal: 35, visibility: "Equipo",
  },
  {
    id: "automatizacion-l2", name: "Automatización Línea 2", code: "AL2-26", description: "Integración de control, sensores y pruebas operacionales.",
    progress: 82, expectedProgress: 80, health: "healthy", dueLabel: "12 sep", dueDate: "2026-09-12", color: "#277164",
    members: [people[0], people[3]], tasksDone: 31, tasksTotal: 38, visibility: "Compartido",
  },
  {
    id: "mejora-logistica", name: "Optimización Logística", code: "LOG-08", description: "Rediseño del flujo de materiales y zonas de preparación.",
    progress: 41, expectedProgress: 59, health: "delayed", dueLabel: "04 ago", dueDate: "2026-08-04", color: "#b4483d",
    members: [people[0], people[2], people[4]], tasksDone: 11, tasksTotal: 27, visibility: "Equipo",
  },
  {
    id: "piloto-energia", name: "Piloto Eficiencia Energética", code: "ENE-14", description: "Instrumentación y evaluación del consumo en equipos críticos.",
    progress: 29, expectedProgress: 31, health: "healthy", dueLabel: "18 oct", dueDate: "2026-10-18", color: "#427358",
    members: [people[1], people[4]], tasksDone: 7, tasksTotal: 24, visibility: "Privado",
  },
];

export const tasks: Task[] = [
  { id: "t1", projectId: "planta-norte", title: "Ingeniería de detalle", owner: people[1], start: 1, duration: 5, progress: 100, status: "done", due: "03 jul", section: "Diseño" },
  { id: "t2", projectId: "planta-norte", title: "Revisión y aprobación técnica", owner: people[0], start: 5, duration: 4, progress: 75, status: "review", due: "17 jul", section: "Diseño" },
  { id: "t3", projectId: "planta-norte", title: "Compra de equipamiento", owner: people[2], start: 7, duration: 8, progress: 46, status: "progress", due: "01 ago", blockedBy: "Revisión y aprobación técnica", section: "Adquisiciones" },
  { id: "t4", projectId: "planta-norte", title: "Obras civiles área norte", owner: people[3], start: 10, duration: 9, progress: 35, status: "progress", due: "12 ago", section: "Ejecución" },
  { id: "t5", projectId: "planta-norte", title: "Montaje eléctrico", owner: people[4], start: 17, duration: 7, progress: 0, status: "blocked", due: "22 ago", blockedBy: "Obras civiles área norte", section: "Ejecución" },
  { id: "t6", projectId: "planta-norte", title: "Pruebas y puesta en marcha", owner: people[1], start: 23, duration: 6, progress: 0, status: "todo", due: "28 ago", section: "Cierre" },
  { id: "t7", projectId: "automatizacion-l2", title: "Configuración PLC", owner: people[3], start: 2, duration: 6, progress: 100, status: "done", due: "08 jul", section: "Control" },
  { id: "t8", projectId: "automatizacion-l2", title: "Pruebas de integración", owner: people[3], start: 9, duration: 5, progress: 70, status: "progress", due: "19 jul", section: "Pruebas" },
  { id: "t9", projectId: "mejora-logistica", title: "Validar layout con operaciones", owner: people[2], start: 3, duration: 5, progress: 55, status: "blocked", due: "11 jul", overdue: true, section: "Diseño" },
  { id: "t10", projectId: "mejora-logistica", title: "Definir rutas de abastecimiento", owner: people[4], start: 7, duration: 5, progress: 30, status: "progress", due: "18 jul", section: "Diseño" },
];

export const weekItems = [
  { id: "w1", title: "Cerrar revisión de ingeniería de detalle", project: "Expansión Planta Norte", due: "Hoy", priority: "Alta", done: false, owner: people[0] },
  { id: "w2", title: "Validar layout con equipo de operaciones", project: "Optimización Logística", due: "Atrasada · 3 días", priority: "Crítica", done: false, owner: people[2] },
  { id: "w3", title: "Revisar resultados de pruebas PLC", project: "Automatización Línea 2", due: "Mié, 15 jul", priority: "Media", done: false, owner: people[3] },
  { id: "w4", title: "Enviar especificación de medidores", project: "Piloto Eficiencia Energética", due: "Jue, 16 jul", priority: "Media", done: false, owner: people[1] },
  { id: "w5", title: "Actualizar matriz de riesgos del proyecto", project: "Expansión Planta Norte", due: "Completada ayer", priority: "Baja", done: true, owner: people[0] },
];
