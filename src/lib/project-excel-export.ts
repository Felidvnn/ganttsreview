import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { taskDurationDays, taskOverdueDays } from "@/lib/task-filters";
import { calculateTaskDelayMetrics } from "@/lib/task-delay-metrics";
import { sortTasksByDate, taskDepth, taskDisplaySection } from "@/lib/task-order";
import { statusLabel, type ProjectTaskStatus } from "@/lib/task-statuses";
import type { Project, Task } from "@/lib/types";

const COLORS = {
  dark: "FF173E34",
  green: "FF2F7669",
  pale: "FFEAF2EF",
  lighter: "FFF7FAF8",
  grid: "FFDDE7E2",
  muted: "FF718079",
  red: "FFB64E4E",
  amber: "FFC4843D",
  white: "FFFFFFFF",
};

function asDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function argb(color?: string, fallback = "2F7669") {
  const normalized = color?.replace("#", "").toUpperCase();
  return `FF${normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback}`;
}

function paleColor(color?: string, whiteRatio = 0.8) {
  const normalized = (color?.replace("#", "") || "2F7669").toUpperCase();
  const safe = /^[0-9A-F]{6}$/.test(normalized) ? normalized : "2F7669";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(safe.slice(offset, offset + 2), 16));
  return `FF${channels.map((channel) => Math.round(channel + (255 - channel) * whiteRatio).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function ownerLabel(task: Task) {
  const owners = task.owners?.map((owner) => owner.name).filter(Boolean) ?? [];
  return owners.length ? owners.join(", ") : task.owner?.name || task.manualAssignee || "Sin asignar";
}

function exportSections(tasks: Task[], configured: string[]) {
  const names = [...configured];
  for (const task of tasks) {
    const section = taskDisplaySection(task, tasks);
    if (!names.includes(section)) names.push(section);
  }
  return names.length ? names : ["General"];
}

function sectionTaskCodes(tasks: Task[], sectionNumber: number) {
  const codes = new Map<string, string>();
  const childCounters = new Map<string, number>();
  let rootCounter = 0;

  for (const task of tasks) {
    const parentCode = task.parentId ? codes.get(task.parentId) : undefined;
    if (task.parentId && parentCode) {
      const next = (childCounters.get(task.parentId) ?? 0) + 1;
      childCounters.set(task.parentId, next);
      codes.set(task.id, `${parentCode}.${next}`);
    } else {
      rootCounter += 1;
      codes.set(task.id, `${sectionNumber}.${rootCounter}`);
    }
  }
  return codes;
}

function timelineDays(project: Project, tasks: Task[]) {
  const dates = tasks.flatMap((task) => [asDate(task.startDate), asDate(task.dueDate), asDate(task.actualCompletionDate)].filter((date): date is Date => Boolean(date)));
  if (!dates.length) dates.push(...[asDate(project.startDate), asDate(project.dueDate)].filter((date): date is Date => Boolean(date)));

  const today = new Date(); today.setHours(12, 0, 0, 0);
  const start = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : new Date(today);
  const end = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date(today);
  if (!dates.length) { start.setDate(start.getDate() - 7); end.setDate(end.getDate() + 21); }

  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(new Date(cursor));
  if (days.length > 16000) throw new Error("El rango supera el máximo diario permitido por Excel. Acorta las fechas antes de exportar.");
  return { days, start, end, today };
}

function setSolidFill(cell: { fill: unknown }, color: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
}

function styleGanttHeader(cell: { value: unknown; font: unknown; fill: unknown; alignment: unknown; border: unknown }, value: string, fill: string, align: "left" | "center" = "center") {
  cell.value = value;
  cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  cell.border = { right: { style: "thin", color: { argb: "FF9AB7AD" } }, bottom: { style: "thin", color: { argb: "FF9AB7AD" } } };
}

export async function buildProjectExcelWorkbook(
  project: Project,
  tasks: Task[],
  statuses: ProjectTaskStatus[],
  configuredSections: string[],
  filtersActive: boolean,
  backupTasks: Task[] = tasks,
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Orbit";
  workbook.company = "Equipo D2";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const ordered = sortTasksByDate(tasks);
  const sectionNames = exportSections(ordered, configuredSections);
  const statusesByValue = new Map(statuses.map((status) => [status.status, status]));
  const timeline = timelineDays(project, ordered);

  buildVisualGantt(workbook, project, ordered, statuses, statusesByValue, sectionNames, timeline, filtersActive);
  buildExecutiveSheet(workbook, project, ordered, statuses, statusesByValue, sectionNames, timeline.today, filtersActive);
  buildBackupSheet(workbook, sortTasksByDate(backupTasks), configuredSections);
  return workbook.xlsx.writeBuffer();
}

function buildVisualGantt(
  workbook: import("exceljs").Workbook,
  project: Project,
  tasks: Task[],
  statuses: ProjectTaskStatus[],
  statusesByValue: Map<string, ProjectTaskStatus>,
  sectionNames: string[],
  timeline: { days: Date[]; start: Date; end: Date; today: Date },
  filtersActive: boolean,
) {
  const sheet = workbook.addWorksheet("Gantt visual", {
    views: [{ state: "frozen", xSplit: 11, ySplit: 7, topLeftCell: "L8", activeCell: "B8" }],
    properties: { defaultRowHeight: 19, outlineLevelRow: 4 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } },
    headerFooter: { oddFooter: "&LOrbit · &F&C&P de &N&RGenerado &D" },
  });
  const informationColumnCount = 11;
  const timelineColumn = informationColumnCount + 1;
  const lastColumn = timelineColumn + timeline.days.length - 1;
  const projectColor = argb(project.color);
  const metadata = [
    { header: "N°", width: 11 },
    { header: "Actividad", width: 42 },
    { header: "Tipo de tarea", width: 18 },
    { header: "Responsables", width: 24 },
    { header: "Estado", width: 16 },
    { header: "Prioridad", width: 12 },
    { header: "Avance", width: 11 },
    { header: "Inicio", width: 13 },
    { header: "Fin", width: 13 },
    { header: "Días", width: 9 },
    { header: "Fecha real", width: 13 },
  ];
  metadata.forEach((item, index) => { sheet.getColumn(index + 1).width = item.width; });
  timeline.days.forEach((_, index) => { sheet.getColumn(timelineColumn + index).width = 3.25; });

  sheet.mergeCells(1, 1, 1, lastColumn);
  const title = sheet.getCell(1, 1); title.value = `Carta Gantt · ${project.name}`; title.font = { name: "Aptos Display", size: 20, bold: true, color: { argb: COLORS.white } }; setSolidFill(title, COLORS.dark); title.alignment = { vertical: "middle" }; sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, lastColumn);
  const description = sheet.getCell(2, 1); description.value = project.description || "Planificación general del proyecto"; description.font = { name: "Aptos", size: 10, color: { argb: "FFDCE9E4" } }; setSolidFill(description, COLORS.dark); description.alignment = { vertical: "middle" }; sheet.getRow(2).height = 25;

  sheet.mergeCells(3, 1, 3, 4); sheet.getCell(3, 1).value = filtersActive ? `ALCANCE · ${tasks.length} tareas según los filtros activos` : `ALCANCE · Proyecto completo · ${tasks.length} tareas`;
  sheet.mergeCells(3, 5, 3, 7); sheet.getCell(3, 5).value = `PERIODO · ${format(timeline.start, "dd MMM yyyy", { locale: es })} — ${format(timeline.end, "dd MMM yyyy", { locale: es })}`;
  sheet.mergeCells(3, 8, 3, 11); sheet.getCell(3, 8).value = "PLANIFICADO · Inicio y fin · REAL · Cierre informado";
  sheet.mergeCells(3, timelineColumn, 3, lastColumn); sheet.getCell(3, timelineColumn).value = "Oscuro: avance · claro: trabajo planificado · punto rojo: cierre real fuera de plazo";
  sheet.getRow(3).eachCell((cell) => { cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.dark } }; setSolidFill(cell, COLORS.pale); cell.alignment = { vertical: "middle", wrapText: true }; });
  sheet.getRow(3).height = 25; sheet.getRow(4).height = 8;

  metadata.forEach((item, index) => {
    sheet.mergeCells(5, index + 1, 7, index + 1);
    styleGanttHeader(sheet.getCell(5, index + 1), item.header, projectColor, [1, 2, 3].includes(index) ? "left" : "center");
  });
  let monthStart = 0;
  while (monthStart < timeline.days.length) {
    let monthEnd = monthStart;
    while (monthEnd + 1 < timeline.days.length && timeline.days[monthEnd + 1].getMonth() === timeline.days[monthStart].getMonth() && timeline.days[monthEnd + 1].getFullYear() === timeline.days[monthStart].getFullYear()) monthEnd += 1;
    const from = timelineColumn + monthStart; const to = timelineColumn + monthEnd;
    if (from < to) sheet.mergeCells(5, from, 5, to);
    const cell = sheet.getCell(5, from); const label = format(timeline.days[monthStart], "MMMM yyyy", { locale: es });
    cell.value = label.charAt(0).toUpperCase() + label.slice(1); cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.white } }; setSolidFill(cell, COLORS.dark); cell.alignment = { horizontal: "center", vertical: "middle" }; cell.border = { right: { style: "medium", color: { argb: COLORS.white } }, bottom: { style: "thin", color: { argb: "FF86A89C" } } };
    monthStart = monthEnd + 1;
  }

  timeline.days.forEach((day, index) => {
    const column = timelineColumn + index; const weekend = day.getDay() === 0 || day.getDay() === 6; const isToday = format(day, "yyyy-MM-dd") === format(timeline.today, "yyyy-MM-dd");
    const number = sheet.getCell(6, column); number.value = day.getDate(); number.font = { name: "Aptos", size: 8, bold: isToday, color: { argb: isToday ? COLORS.white : COLORS.dark } }; setSolidFill(number, isToday ? projectColor : weekend ? "FFE4EBE8" : COLORS.pale); number.alignment = { horizontal: "center", vertical: "middle" };
    const weekday = sheet.getCell(7, column); weekday.value = format(day, "EEEEE", { locale: es }).toUpperCase(); weekday.font = { name: "Aptos", size: 7, bold: isToday, color: { argb: isToday ? COLORS.white : COLORS.muted } }; setSolidFill(weekday, isToday ? projectColor : weekend ? "FFE4EBE8" : COLORS.lighter); weekday.alignment = { horizontal: "center", vertical: "middle" };
    for (const cell of [number, weekday]) cell.border = { right: { style: "hair", color: { argb: COLORS.grid } }, bottom: { style: "thin", color: { argb: COLORS.grid } } };
  });
  sheet.getRow(5).height = 22; sheet.getRow(6).height = 17; sheet.getRow(7).height = 17;

  let rowNumber = 8;
  sectionNames.forEach((section, sectionIndex) => {
    const sectionTasks = tasks.filter((task) => taskDisplaySection(task, tasks) === section);
    sheet.mergeCells(rowNumber, 1, rowNumber, informationColumnCount);
    const sectionCell = sheet.getCell(rowNumber, 1); sectionCell.value = `${sectionIndex + 1}. ${section.toUpperCase()}     ·     ${sectionTasks.length} ${sectionTasks.length === 1 ? "actividad" : "actividades"}`; sectionCell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.dark } }; setSolidFill(sectionCell, "FFDCEAE5"); sectionCell.alignment = { vertical: "middle" };
    for (let column = timelineColumn; column <= lastColumn; column += 1) { const cell = sheet.getCell(rowNumber, column); setSolidFill(cell, "FFDCEAE5"); cell.border = { bottom: { style: "thin", color: { argb: "FFB7CCC4" } } }; }
    sheet.getRow(rowNumber).height = 23; rowNumber += 1;

    if (!sectionTasks.length) {
      const row = sheet.getRow(rowNumber); row.getCell(2).value = "Sin tareas en esta sección"; row.getCell(2).font = { name: "Aptos", size: 9, italic: true, color: { argb: COLORS.muted } }; row.getCell(2).alignment = { indent: 1, vertical: "middle" }; row.height = 21; rowNumber += 1; return;
    }

    const codes = sectionTaskCodes(sectionTasks, sectionIndex + 1);
    sectionTasks.forEach((task) => {
      const row = sheet.getRow(rowNumber); const depth = taskDepth(task, tasks); const start = asDate(task.startDate); const due = asDate(task.dueDate); const actual = asDate(task.actualCompletionDate); const inconsistent = Boolean(start && due && due < start); const status = statusesByValue.get(task.status); const taskColor = task.color || status?.color || project.color;
      row.values = [
        codes.get(task.id) || "",
        task.title,
        task.taskTypeName || (task.isMilestone ? "Hito" : "Tarea"),
        ownerLabel(task),
        statusLabel(task.status, statuses),
        task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media",
        task.progress / 100,
        start,
        due,
        taskDurationDays(task),
        actual,
      ];
      row.height = depth ? 21 : 23; row.outlineLevel = Math.min(depth, 7);
      row.getCell(1).font = { name: "Aptos", size: 8, color: { argb: COLORS.muted } }; row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).font = { name: "Aptos", size: 9, bold: depth === 0, color: { argb: COLORS.dark } }; row.getCell(2).alignment = { indent: Math.min(depth, 6), vertical: "middle" };
      row.getCell(3).font = { name: "Aptos", size: 8, bold: true, color: { argb: argb(task.taskTypeColor, "6B7D75") } }; setSolidFill(row.getCell(3), paleColor(task.taskTypeColor || "#6B7D75", 0.84)); row.getCell(3).alignment = { vertical: "middle", wrapText: true };
      row.getCell(4).font = { name: "Aptos", size: 8, color: { argb: COLORS.muted } }; row.getCell(4).alignment = { vertical: "middle", wrapText: true };
      row.getCell(5).font = { name: "Aptos", size: 8, bold: true, color: { argb: argb(status?.color, "68766F") } }; setSolidFill(row.getCell(5), paleColor(status?.color)); row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      const priorityColor = task.priority === 3 ? COLORS.red : task.priority === 1 ? "FF617B72" : "FF97662D";
      row.getCell(6).font = { name: "Aptos", size: 8, bold: true, color: { argb: priorityColor } }; setSolidFill(row.getCell(6), task.priority === 3 ? "FFFFEEEB" : task.priority === 1 ? "FFEDF3F1" : "FFFFF5E7"); row.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(7).numFmt = "0%"; row.getCell(7).alignment = { horizontal: "center", vertical: "middle" }; row.getCell(7).font = { name: "Aptos", size: 8, bold: true, color: { argb: COLORS.dark } };
      [8, 9].forEach((column) => { row.getCell(column).numFmt = "dd-mm-yyyy"; row.getCell(column).alignment = { horizontal: "center", vertical: "middle" }; row.getCell(column).font = { name: "Aptos", size: 8, color: { argb: inconsistent ? COLORS.red : COLORS.dark }, bold: inconsistent }; });
      row.getCell(10).alignment = { horizontal: "center", vertical: "middle" }; row.getCell(10).font = { name: "Aptos", size: 8, color: { argb: COLORS.dark } };
      row.getCell(11).numFmt = "dd-mm-yyyy"; row.getCell(11).alignment = { horizontal: "center", vertical: "middle" }; row.getCell(11).font = { name: "Aptos", size: 8, bold: Boolean(actual && due && actual > due), color: { argb: actual && due && actual > due ? COLORS.red : COLORS.dark } }; if (actual && due && actual > due) setSolidFill(row.getCell(11), "FFFFEEEB");
      for (let column = 1; column <= lastColumn; column += 1) row.getCell(column).border = { bottom: { style: "hair", color: { argb: COLORS.grid } }, right: { style: "hair", color: { argb: COLORS.grid } } };

      timeline.days.forEach((day, dayIndex) => {
        const cell = row.getCell(timelineColumn + dayIndex); const weekend = day.getDay() === 0 || day.getDay() === 6; const dayKey = format(day, "yyyy-MM-dd");
        if (weekend) setSolidFill(cell, "FFF4F7F5");
        const marker = start || due;
        if (task.isMilestone && marker && dayKey === format(marker, "yyyy-MM-dd")) {
          cell.value = "◆"; cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: argb(taskColor) } }; cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (start && due) {
          const from = inconsistent ? due : start; const to = inconsistent ? start : due;
          if (day >= from && day <= to) {
            const elapsed = Math.max(1, differenceInCalendarDays(to, from) + 1); const position = differenceInCalendarDays(day, from) + 1; const completed = position <= Math.round(elapsed * task.progress / 100);
            setSolidFill(cell, inconsistent ? "FFFFD9D5" : completed ? argb(taskColor) : paleColor(taskColor, 0.68));
          }
        } else if (marker && dayKey === format(marker, "yyyy-MM-dd")) {
          setSolidFill(cell, paleColor(taskColor, 0.45));
        }
        if (actual && dayKey === format(actual, "yyyy-MM-dd")) {
          const late = Boolean(due && actual > due); cell.value = "●"; cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.white } }; setSolidFill(cell, late ? COLORS.red : projectColor); cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
      rowNumber += 1;
    });
  });
  sheet.pageSetup.printTitlesRow = "1:7";
}

function buildExecutiveSheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  tasks: Task[],
  statuses: ProjectTaskStatus[],
  statusesByValue: Map<string, ProjectTaskStatus>,
  sectionNames: string[],
  today: Date,
  filtersActive: boolean,
) {
  const sheet = workbook.addWorksheet("Resumen ejecutivo", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.15, footer: 0.15 } },
    headerFooter: { oddFooter: "&LOrbit · Resumen ejecutivo&C&P de &N&R&D" },
  });
  [11, 18, 38, 28, 18, 26, 14, 15, 13, 13, 13, 13, 12, 13, 20, 42].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  const projectColor = argb(project.color);

  sheet.mergeCells("A1:P1"); const title = sheet.getCell("A1"); title.value = project.name; title.font = { name: "Aptos Display", size: 20, bold: true, color: { argb: COLORS.white } }; setSolidFill(title, COLORS.dark); title.alignment = { vertical: "middle" }; sheet.getRow(1).height = 34;
  sheet.mergeCells("A2:P2"); const description = sheet.getCell("A2"); description.value = `${project.description || "Resumen de planificación"} · Generado ${format(today, "dd MMMM yyyy", { locale: es })}${filtersActive ? " · Filtros activos aplicados" : ""}`; description.font = { name: "Aptos", size: 9, color: { argb: "FFDCE9E4" } }; setSolidFill(description, COLORS.dark); sheet.getRow(2).height = 24;
  sheet.getRow(3).height = 8;

  const roots = tasks.filter((task) => !task.parentId || !tasks.some((candidate) => candidate.id === task.parentId));
  const progress = roots.length ? Math.round(roots.reduce((total, task) => total + task.progress, 0) / roots.length) : 0;
  const delayMetrics = calculateTaskDelayMetrics(tasks, today);
  const overdueCount = delayMetrics.affectedTaskCount;
  const cards = [
    { from: 1, to: 4, label: "AVANCE GENERAL", value: `${progress}%`, color: projectColor },
    { from: 5, to: 8, label: "ACTIVIDADES", value: String(tasks.length), color: COLORS.dark },
    { from: 9, to: 12, label: "COMPLETADAS", value: String(tasks.filter((task) => task.status === "done" || task.progress >= 100).length), color: projectColor },
    { from: 13, to: 16, label: "CON ATRASO", value: String(overdueCount), color: overdueCount ? COLORS.red : projectColor },
  ];
  cards.forEach((card) => {
    sheet.mergeCells(4, card.from, 4, card.to); const cell = sheet.getCell(4, card.from); cell.value = `${card.label}\n${card.value}`; cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: card.color } }; setSolidFill(cell, COLORS.lighter); cell.alignment = { vertical: "middle", wrapText: true, indent: 1 }; cell.border = { left: { style: "medium", color: { argb: card.color } }, bottom: { style: "thin", color: { argb: COLORS.grid } }, top: { style: "thin", color: { argb: COLORS.grid } }, right: { style: "thin", color: { argb: COLORS.grid } } };
  });
  sheet.getRow(4).height = 43; sheet.getRow(5).height = 8;

  sheet.mergeCells("A6:F6"); const sectionTitle = sheet.getCell("A6"); sectionTitle.value = "AVANCE POR SECCIÓN"; sectionTitle.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.white } }; setSolidFill(sectionTitle, projectColor);
  ["Sección", "Total", "Completadas", "Pendientes", "Atrasadas", "Avance"].forEach((header, index) => {
    const cell = sheet.getRow(7).getCell(index + 1); cell.value = header; cell.font = { name: "Aptos", size: 8, bold: true, color: { argb: COLORS.white } }; setSolidFill(cell, COLORS.dark); cell.alignment = { horizontal: index ? "center" : "left", vertical: "middle" };
  });

  let rowNumber = 8;
  sectionNames.forEach((section) => {
    const sectionTasks = tasks.filter((task) => taskDisplaySection(task, tasks) === section); const completed = sectionTasks.filter((task) => task.status === "done" || task.progress >= 100).length; const delayed = calculateTaskDelayMetrics(sectionTasks, today).affectedTaskCount;
    const row = sheet.getRow(rowNumber); row.values = [section, sectionTasks.length, completed, sectionTasks.length - completed, delayed, sectionTasks.length ? sectionTasks.reduce((total, task) => total + task.progress, 0) / sectionTasks.length / 100 : 0]; row.getCell(6).numFmt = "0%";
    for (let column = 1; column <= 6; column += 1) { const cell = row.getCell(column); cell.font = { name: "Aptos", size: 9, color: { argb: column === 5 && delayed ? COLORS.red : COLORS.dark }, bold: column === 1 }; setSolidFill(cell, rowNumber % 2 ? COLORS.lighter : COLORS.white); cell.alignment = { horizontal: column === 1 ? "left" : "center", vertical: "middle" }; cell.border = { bottom: { style: "hair", color: { argb: COLORS.grid } } }; }
    rowNumber += 1;
  });

  rowNumber += 1;
  const headerRow = rowNumber;
  const headers = ["N°", "Sección", "Actividad", "Tarea padre", "Tipo", "Responsables", "Prioridad", "Estado", "Avance", "Inicio", "Fin", "Fecha real", "Días", "Desviación", "Alerta", "Descripción"];
  headers.forEach((header, index) => { const cell = sheet.getRow(headerRow).getCell(index + 1); cell.value = header; cell.font = { name: "Aptos", size: 8, bold: true, color: { argb: COLORS.white } }; setSolidFill(cell, projectColor); cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = { right: { style: "hair", color: { argb: "FF9AB7AD" } } }; }); sheet.getRow(headerRow).height = 27;
  rowNumber += 1;

  sectionNames.forEach((section, sectionIndex) => {
    const sectionTasks = tasks.filter((task) => taskDisplaySection(task, tasks) === section); const codes = sectionTaskCodes(sectionTasks, sectionIndex + 1);
    sectionTasks.forEach((task) => {
      const parent = task.parentId ? tasks.find((candidate) => candidate.id === task.parentId) : undefined; const start = asDate(task.startDate); const due = asDate(task.dueDate); const actual = asDate(task.actualCompletionDate); const overdue = taskOverdueDays(task, today); const deviation = actual && due ? differenceInCalendarDays(actual, due) : overdue; const inconsistent = Boolean(start && due && due < start); const status = statusesByValue.get(task.status); const alert = inconsistent ? "Revisar fechas" : deviation > 0 ? actual ? "Cierre fuera de plazo" : "Tarea vencida" : task.status === "blocked" ? "Bloqueada" : "En línea";
      const row = sheet.getRow(rowNumber); row.values = [codes.get(task.id) || "", section, task.title, parent?.title || "", task.taskTypeName || (task.isMilestone ? "Hito" : "Tarea"), ownerLabel(task), task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media", statusLabel(task.status, statuses), task.progress / 100, start, due, actual, taskDurationDays(task), deviation, alert, task.description || ""];
      row.height = 22;
      for (let column = 1; column <= 16; column += 1) {
        const cell = row.getCell(column); const centered = [1, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(column);
        cell.font = { name: "Aptos", size: 8, color: { argb: COLORS.dark }, bold: column === 3 && taskDepth(task, tasks) === 0 };
        cell.alignment = { vertical: "middle", wrapText: [4, 6, 16].includes(column), horizontal: centered ? "center" : "left", indent: column === 3 ? Math.min(taskDepth(task, tasks), 6) : 0 };
        cell.border = { bottom: { style: "hair", color: { argb: COLORS.grid } }, right: { style: "hair", color: { argb: COLORS.grid } } };
        if (rowNumber % 2) setSolidFill(cell, COLORS.lighter);
      }
      row.getCell(9).numFmt = "0%"; [10, 11, 12].forEach((column) => { row.getCell(column).numFmt = "dd-mm-yyyy"; });
      setSolidFill(row.getCell(8), paleColor(status?.color)); row.getCell(8).font = { name: "Aptos", size: 8, bold: true, color: { argb: argb(status?.color, "68766F") } };
      row.getCell(15).font = { name: "Aptos", size: 8, bold: alert !== "En línea", color: { argb: inconsistent || deviation > 0 ? COLORS.red : task.status === "blocked" ? COLORS.amber : projectColor } };
      rowNumber += 1;
    });
  });

  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, rowNumber - 1), column: 16 } };
  sheet.pageSetup.printTitlesRow = `1:${headerRow}`;
}

function buildBackupSheet(workbook: import("exceljs").Workbook, tasks: Task[], configuredSections: string[]) {
  const sheet = workbook.addWorksheet("Respaldo", {
    views: [{ state: "frozen", ySplit: 1, activeCell: "D2" }],
    properties: { tabColor: { argb: COLORS.green } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const headers = ["ID", "ID padre", "Sección", "Tarea", "Tipo", "Inicio", "Fin", "Fecha real", "Hito", "Estado", "Prioridad", "Avance", "Responsable", "Descripción"];
  sheet.addRow(headers);
  [10, 12, 20, 38, 18, 14, 14, 14, 10, 16, 12, 12, 24, 48].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  const header = sheet.getRow(1); header.height = 26;
  header.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.white } };
    setSolidFill(cell, COLORS.green);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { right: { style: "hair", color: { argb: "FF9AB7AD" } }, bottom: { style: "thin", color: { argb: COLORS.dark } } };
  });

  const sections = exportSections(tasks, configuredSections);
  const references = new Map<string, string>();
  sections.forEach((section, sectionIndex) => {
    const sectionTasks = tasks.filter((task) => taskDisplaySection(task, tasks) === section);
    const codes = sectionTaskCodes(sectionTasks, sectionIndex + 1);
    codes.forEach((code, taskId) => references.set(taskId, code));
  });

  let rowNumber = 2;
  sections.forEach((section) => {
    const sectionTasks = tasks.filter((task) => taskDisplaySection(task, tasks) === section);
    if (!sectionTasks.length) {
      const row = sheet.getRow(rowNumber); row.getCell(3).value = section; row.getCell(3).font = { name: "Aptos", size: 9, italic: true, color: { argb: COLORS.muted } }; setSolidFill(row.getCell(3), COLORS.lighter); row.height = 20; rowNumber += 1;
      return;
    }

    sectionTasks.forEach((task) => {
      const start = asDate(task.startDate); const due = asDate(task.dueDate); const actual = asDate(task.actualCompletionDate);
      const primaryOwner = task.owners?.find((owner) => owner.name)?.name || task.owner?.name || task.manualAssignee || "";
      const row = sheet.getRow(rowNumber);
      row.values = [
        references.get(task.id) || String(rowNumber - 1),
        task.parentId ? references.get(task.parentId) || "" : "",
        section,
        task.title,
        task.taskTypeName || (task.isMilestone ? "Hito" : "Tarea"),
        start,
        due,
        actual,
        task.isMilestone ? "Sí" : "No",
        task.status,
        task.priority === 3 ? "Alta" : task.priority === 1 ? "Baja" : "Media",
        task.progress,
        primaryOwner,
        task.description || "",
      ];
      row.height = 21;
      [6, 7, 8].forEach((column) => { row.getCell(column).numFmt = "yyyy-mm-dd"; });
      for (let column = 1; column <= headers.length; column += 1) {
        const cell = row.getCell(column);
        cell.font = { name: "Aptos", size: 9, color: { argb: COLORS.dark } };
        cell.alignment = { vertical: "middle", horizontal: [1, 2, 6, 7, 8, 9, 10, 11, 12].includes(column) ? "center" : "left", wrapText: column === 13 || column === 14 };
        cell.border = { bottom: { style: "hair", color: { argb: COLORS.grid } }, right: { style: "hair", color: { argb: COLORS.grid } } };
        if (rowNumber % 2) setSolidFill(cell, COLORS.lighter);
      }
      row.getCell(4).alignment = { vertical: "middle", horizontal: "left", indent: Math.min(taskDepth(task, tasks), 6) };
      rowNumber += 1;
    });
  });

  for (let row = 2; row <= Math.max(2, rowNumber - 1); row += 1) {
    sheet.getCell(row, 9).dataValidation = { type: "list", allowBlank: false, formulae: ['"Sí,No"'] };
    sheet.getCell(row, 10).dataValidation = { type: "list", allowBlank: false, formulae: ['"todo,progress,review,blocked,done"'] };
    sheet.getCell(row, 11).dataValidation = { type: "list", allowBlank: false, formulae: ['"Baja,Media,Alta"'] };
    sheet.getCell(row, 12).dataValidation = { type: "whole", operator: "between", allowBlank: false, formulae: [0, 100] };
  }
  sheet.autoFilter = { from: "A1", to: `N${Math.max(1, rowNumber - 1)}` };
  sheet.pageSetup.printTitlesRow = "1:1";
}
