"use client";

import { CalendarDays, Check, CheckSquare2, Download, FileSpreadsheet, FolderKanban, Milestone, Plus, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { projects as demoProjects } from "@/lib/demo-data";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type ProjectOption = { id: string; name: string };
type QuickMember = { user_id: string; full_name: string; email: string };
type ImportTaskRow = { ref: string; parentRef: string; section: string; title: string; type: string; startDate: string; dueDate: string; actualDate: string; milestone: boolean; status: string; priority: number; progress: number; owner: string; description: string };
const suggestedSections = ["General", "Planificación", "Ejecución", "Cierre"];
const importHeaders = ["ID", "ID padre", "Sección", "Tarea", "Tipo", "Inicio", "Fin", "Fecha real", "Hito", "Estado", "Prioridad", "Avance", "Responsable", "Descripción"];

function importKey(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase(); }
function importDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim(); if (!text) return "";
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); return local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : text;
}
function importedStatus(value: unknown) { const key = importKey(value); return ({ pendiente: "todo", todo: "todo", "en curso": "progress", progreso: "progress", progress: "progress", revision: "review", review: "review", bloqueada: "blocked", bloqueado: "blocked", blocked: "blocked", completada: "done", completado: "done", done: "done" } as Record<string, string>)[key] || "todo"; }
function importedPriority(value: unknown) { const key = importKey(value); return key === "alta" || key === "3" ? 3 : key === "baja" || key === "1" ? 1 : 2; }
function importedBoolean(value: unknown) { return ["si", "sí", "true", "1", "x"].includes(importKey(value)); }

function sectionErrorMessage(message: string, code?: string) {
  return message.includes("project_sections") || message.includes("add_project_section") || message.includes("create_project_with_sections") || code === "PGRST202"
    ? "Falta aplicar la migración 202607140004_project_sections.sql en Supabase."
    : message;
}

export function QuickCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [created, setCreated] = useState(false);
  const [kind, setKind] = useState<"task" | "project" | "milestone">("task");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectStart, setProjectStart] = useState("");
  const [projectDue, setProjectDue] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared" | "workspace">("private");
  const [projectId, setProjectId] = useState(hasSupabaseConfig ? "" : demoProjects[0].id);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>(hasSupabaseConfig ? [] : demoProjects.map(({ id, name }) => ({ id, name })));
  const [sectionsByProject, setSectionsByProject] = useState<Record<string, string[]>>({});
  const [section, setSection] = useState("General");
  const [initialSections, setInitialSections] = useState(suggestedSections);
  const [initialSectionDraft, setInitialSectionDraft] = useState("");
  const [newSectionDraft, setNewSectionDraft] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importRows, setImportRows] = useState<ImportTaskRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [quickMembers, setQuickMembers] = useState<QuickMember[]>([]);
  const [selectedQuickAssignees, setSelectedQuickAssignees] = useState<string[]>([]);
  const [newQuickAssignee, setNewQuickAssignee] = useState("");

  useEffect(() => {
    if (!open || !hasSupabaseConfig) return;
    let active = true;
    const load = async () => {
      const supabase = createClient()!;
      const { data: projects, error: projectsError } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
      if (!active) return;
      if (projectsError) { setError(projectsError.message); return; }
      const options = projects ?? [];
      setProjectOptions(options);
      const firstId = options[0]?.id ?? "";
      setProjectId(firstId);
      if (!options.length) { setKind("project"); return; }

      const { data: sectionRows, error: sectionsError } = await supabase.from("project_sections")
        .select("project_id,name,sort_order").in("project_id", options.map((project) => project.id)).order("sort_order");
      if (!active) return;
      if (sectionsError) {
        setError(sectionErrorMessage(sectionsError.message, sectionsError.code));
        const fallback = Object.fromEntries(options.map((project) => [project.id, ["General"]]));
        setSectionsByProject(fallback); setSection("General");
        return;
      }
      const grouped: Record<string, string[]> = Object.fromEntries(options.map((project) => [project.id, []]));
      for (const row of sectionRows ?? []) grouped[row.project_id]?.push(row.name);
      for (const project of options) if (!grouped[project.id].length) grouped[project.id] = ["General"];
      setSectionsByProject(grouped);
      setSection(grouped[firstId]?.[0] ?? "General");
      if (firstId) loadQuickAssignees(firstId);
    };
    load();
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  const loadQuickAssignees = async (targetProject: string) => {
    if (!hasSupabaseConfig || !targetProject) return;
    const supabase = createClient()!;
    const [members, directory] = await Promise.all([
      supabase.rpc("get_project_assignable_members", { target_project: targetProject }),
      supabase.from("project_external_assignees").select("id,name").eq("project_id", targetProject).order("name"),
    ]);
    setQuickMembers([...(members.data || []) as QuickMember[], ...(directory.data || []).map((item) => ({ user_id: `external:${item.id}`, full_name: item.name, email: "Responsable del proyecto" }))]);
  };

  const changeProject = (nextProject: string) => {
    setProjectId(nextProject);
    setSection(sectionsByProject[nextProject]?.[0] ?? "General");
    setAddingSection(false); setNewSectionDraft(""); setSelectedQuickAssignees([]); setNewQuickAssignee(""); loadQuickAssignees(nextProject);
  };
  const toggleQuickAssignee = (id: string) => setSelectedQuickAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const addInitialSection = () => {
    const clean = initialSectionDraft.trim();
    if (!clean || initialSections.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    setInitialSections((current) => [...current, clean]);
    setInitialSectionDraft("");
  };

  const addSectionToProject = async () => {
    const clean = newSectionDraft.trim();
    if (!clean || !projectId) return;
    const existing = sectionsByProject[projectId]?.find((item) => item.toLowerCase() === clean.toLowerCase());
    if (existing) { setSection(existing); setAddingSection(false); setNewSectionDraft(""); return; }
    setSectionSaving(true); setError("");
    const { error: rpcError } = await createClient()!.rpc("add_project_section", { target_project: projectId, section_name: clean });
    if (rpcError) { setError(sectionErrorMessage(rpcError.message, rpcError.code)); setSectionSaving(false); return; }
    setSectionsByProject((current) => ({ ...current, [projectId]: [...(current[projectId] ?? []), clean] }));
    setSection(clean); setNewSectionDraft(""); setAddingSection(false); setSectionSaving(false);
  };

  const downloadTemplate = async () => {
    setImportBusy(true); setError("");
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Tareas", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.addRow(importHeaders);
      sheet.addRows([
        ["1", "", "Planificación", "Preparar proyecto", "Proceso", "2026-07-20", "2026-07-24", "", "No", "En curso", "Media", 25, "Equipo D2", "Actividad principal"],
        ["1.1", "1", "Planificación", "Reunión de inicio", "Reunión", "2026-07-21", "2026-07-21", "", "No", "Pendiente", "Alta", 0, "María Pérez", "Subtarea; el padre debe aparecer antes"],
        ["1.1.1", "1.1", "Planificación", "Enviar minuta", "Entregable", "2026-07-22", "2026-07-22", "", "Sí", "Pendiente", "Media", 0, "María Pérez", "Sub-subtarea, último nivel permitido"],
      ]);
      sheet.columns = [10, 12, 18, 34, 18, 14, 14, 14, 10, 16, 12, 12, 22, 42].map((width) => ({ width }));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F7669" } }; sheet.autoFilter = { from: "A1", to: "N1" };
      const help = workbook.addWorksheet("Instrucciones");
      help.addRows([["Cómo importar"], ["Una fila equivale a una tarea. ID debe ser único."], ["Para crear subtareas, escribe en ID padre el ID de una fila anterior. Se admiten dos niveles."], ["Las fechas pueden quedar provisoriamente invertidas; Orbit las marcará para revisión."], ["Estado: Pendiente, En curso, Revisión, Bloqueada o Completada."], ["Prioridad: Baja, Media o Alta. Avance: número entre 0 y 100."], ["Tipo y responsable se guardarán en el proyecto si todavía no existen."]]);
      help.getColumn(1).width = 105; help.getRow(1).font = { bold: true, size: 15, color: { argb: "FF2F7669" } };
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = "plantilla-proyecto-orbit.xlsx"; link.click(); URL.revokeObjectURL(url);
    } catch { setError("No se pudo generar la plantilla Excel."); }
    setImportBusy(false);
  };

  const readTemplate = async (file?: File) => {
    if (!file) return;
    setImportBusy(true); setError("");
    try {
      const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer() as never);
      const sheet = workbook.getWorksheet("Tareas") || workbook.worksheets[0]; if (!sheet) throw new Error("El archivo no contiene una hoja de tareas.");
      const headers = new Map<string, number>(); sheet.getRow(1).eachCell((cell, column) => headers.set(importKey(cell.value), column));
      if (!headers.has("tarea")) throw new Error("La hoja debe conservar la columna Tarea.");
      const value = (row: import("exceljs").Row, header: string) => { const column = headers.get(importKey(header)); return column ? row.getCell(column).value : undefined; };
      const rows: ImportTaskRow[] = [];
      sheet.eachRow((row, number) => { if (number === 1) return; const title = String(value(row, "Tarea") ?? "").trim(); if (!title) return;
        rows.push({ ref: String(value(row, "ID") ?? rows.length + 1).trim(), parentRef: String(value(row, "ID padre") ?? "").trim(), section: String(value(row, "Sección") ?? "General").trim() || "General", title, type: String(value(row, "Tipo") ?? "Tarea").trim() || "Tarea", startDate: importDate(value(row, "Inicio")), dueDate: importDate(value(row, "Fin")), actualDate: importDate(value(row, "Fecha real")), milestone: importedBoolean(value(row, "Hito")), status: importedStatus(value(row, "Estado")), priority: importedPriority(value(row, "Prioridad")), progress: Math.min(100, Math.max(0, Number(value(row, "Avance")) || 0)), owner: String(value(row, "Responsable") ?? "").trim(), description: String(value(row, "Descripción") ?? "").trim() });
      });
      if (!rows.length) throw new Error("No encontramos tareas en la plantilla.");
      setImportRows(rows); setImportFileName(file.name);
    } catch (cause) { setImportRows([]); setImportFileName(""); setError(cause instanceof Error ? cause.message : "No se pudo leer el Excel."); }
    setImportBusy(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    if (hasSupabaseConfig) {
      const supabase = createClient()!;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Tu sesión expiró. Vuelve a ingresar."); setSaving(false); return; }
      if (kind === "project") {
        const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id).limit(1).maybeSingle();
        if (!membership) { setError("Primero debes pertenecer a un espacio de trabajo."); setSaving(false); return; }
        const prefix = name.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 4).toUpperCase() || "PRY";
        const code = `${prefix}-${String(new Date().getFullYear()).slice(-2)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
        const { error: insertError } = await supabase.rpc(importRows.length ? "create_project_from_template" : "create_project_with_sections", {
          target_workspace: membership.workspace_id,
          project_name: name,
          project_code: code,
          project_description: description,
          project_visibility: visibility,
          project_start: projectStart || null,
          project_due: projectDue || null,
          section_names: initialSections,
          ...(importRows.length ? { task_rows: importRows } : {}),
        });
        if (insertError) { setError(importRows.length && insertError.code === "PGRST202" ? "Falta aplicar la migración 202607200018_flexible_dates_task_types_import.sql en Supabase." : sectionErrorMessage(insertError.message, insertError.code)); setSaving(false); return; }
      } else {
        if (!projectId) { setError("Crea primero un proyecto para poder agregar tareas o hitos."); setSaving(false); return; }
        const dueDate = String(form.get("due_date") || "");
        const requestedStart = String(form.get("start_date") || "");
        const startDate = kind === "milestone" ? dueDate || new Date().toISOString().slice(0, 10) : requestedStart || new Date().toISOString().slice(0, 10);
        const selectedUsers = selectedQuickAssignees.filter((id) => !id.startsWith("external:"));
        const selectedDirectory = selectedQuickAssignees.filter((id) => id.startsWith("external:")).map((id) => id.replace("external:", ""));
        const { error: insertError } = await supabase.rpc("create_task_with_assignees", {
          target_project: projectId, task_title: name, task_section: section, task_start: startDate,
          task_due: dueDate || (kind === "milestone" ? startDate : null), task_is_milestone: kind === "milestone",
          target_users: selectedUsers, target_directory_assignees: selectedDirectory, new_assignee_name: newQuickAssignee.trim() || null,
        });
        if (insertError) { setError(insertError.code === "PGRST202" ? "Falta aplicar la migración 202607200019_project_notes_ordering_bulk_copy.sql." : insertError.message); setSaving(false); return; }
      }
    }
    setCreated(true); router.refresh();
    setTimeout(() => {
      setCreated(false); setSaving(false); setName(""); setDescription(""); setProjectStart(""); setProjectDue("");
      setVisibility("private"); setInitialSections(suggestedSections); setImportRows([]); setImportFileName(""); setSelectedQuickAssignees([]); setNewQuickAssignee(""); onClose();
    }, 800);
  };

  const currentSections = sectionsByProject[projectId] ?? ["General"];
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Crear elemento">
      <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
      <section className="modal-card quick-modal">
        <div className="modal-head"><div><span className="eyebrow">ACCIÓN RÁPIDA</span><h2>Crear algo nuevo</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        {created ? <div className="success-state"><span>✓</span><h3>Guardado</h3><p>El elemento ya está disponible para tu equipo.</p></div> : (
          <form onSubmit={submit}>
            <div className="create-types">
              <button type="button" className={kind === "task" ? "selected" : ""} onClick={() => setKind("task")} disabled={hasSupabaseConfig && !projectOptions.length}><CheckSquare2 /><span><b>Tarea</b><small>{hasSupabaseConfig && !projectOptions.length ? "Primero crea un proyecto" : "Una actividad del proyecto"}</small></span></button>
              <button type="button" className={kind === "project" ? "selected" : ""} onClick={() => setKind("project")}><FolderKanban /><span><b>Proyecto</b><small>Plan, fechas y secciones</small></span></button>
              <button type="button" className={kind === "milestone" ? "selected" : ""} onClick={() => setKind("milestone")} disabled={hasSupabaseConfig && !projectOptions.length}><Milestone /><span><b>Hito</b><small>{hasSupabaseConfig && !projectOptions.length ? "Primero crea un proyecto" : "Un punto clave sin duración"}</small></span></button>
            </div>
            <label className="field-label">Nombre<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "project" ? "Ej. Renovación planta sur" : "Ej. Revisar planos eléctricos"} required /></label>

            {kind === "project" ? <>
              <label className="field-label">Descripción breve<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Objetivo y alcance principal del proyecto" rows={3} /></label>
              <div className="form-grid">
                <label className="field-label">Fecha de inicio<input type="date" value={projectStart} onChange={(event) => setProjectStart(event.target.value)} /></label>
                <label className="field-label">Fecha de término<input type="date" value={projectDue} min={projectStart || undefined} onChange={(event) => setProjectDue(event.target.value)} /></label>
              </div>
              <label className="field-label">Visibilidad<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="private">Privado · solo tú</option><option value="shared">Con mi líder · puede verlo y hacer seguimiento</option><option value="workspace">Colaborativo · solo personas invitadas</option></select></label>
              <div className={`project-import-card ${importRows.length ? "ready" : ""}`}><span className="project-import-icon"><FileSpreadsheet size={20} /></span><div><b>Importar planificación desde Excel</b><small>Descarga la plantilla, completa tareas, tipos, fechas y jerarquía; luego súbela aquí.</small>{importFileName && <em>{importFileName} · {importRows.length} tareas listas</em>}</div><button type="button" className="button secondary small" onClick={downloadTemplate} disabled={importBusy}><Download size={14} /> Plantilla</button><label className="button secondary small"><Upload size={14} /> {importRows.length ? "Cambiar" : "Subir Excel"}<input type="file" accept=".xlsx" onChange={(event) => readTemplate(event.target.files?.[0])} /></label>{importRows.length > 0 && <button type="button" className="project-import-clear" onClick={() => { setImportRows([]); setImportFileName(""); }} aria-label="Quitar importación"><X size={14} /></button>}</div>
              <div className="section-builder"><div><span className="field-title">Secciones iniciales</span><small>Podrás agregar más desde el Gantt.</small></div><div className="section-chips">{initialSections.map((item) => <span key={item}>{item}<button type="button" onClick={() => setInitialSections((current) => current.filter((sectionName) => sectionName !== item))} aria-label={`Quitar ${item}`}><X size={12} /></button></span>)}</div><div className="section-add-row"><input value={initialSectionDraft} onChange={(event) => setInitialSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addInitialSection(); } }} placeholder="Nueva sección" /><button type="button" className="button secondary" onClick={addInitialSection}><Plus size={15} /> Agregar</button></div></div>
            </> : <>
              <div className="form-grid">
                <label className="field-label">Proyecto<select value={projectId} onChange={(event) => changeProject(event.target.value)}>{projectOptions.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <label className="field-label">Sección<div className="section-select-row"><select value={section} onChange={(event) => setSection(event.target.value)}>{currentSections.map((item) => <option value={item} key={item}>{item}</option>)}</select><button type="button" className="icon-button" onClick={() => setAddingSection((current) => !current)} title="Agregar sección"><Plus size={17} /></button></div></label>
              </div>
              {addingSection && <div className="section-inline-add"><input autoFocus value={newSectionDraft} onChange={(event) => setNewSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSectionToProject(); } }} placeholder="Nombre de la nueva sección" /><button type="button" className="button secondary" onClick={() => { setAddingSection(false); setNewSectionDraft(""); }}>Cancelar</button><button type="button" className="button primary" onClick={addSectionToProject} disabled={sectionSaving}>{sectionSaving ? "Guardando..." : "Agregar"}</button></div>}
              <div className="form-grid">
                {kind === "task" && <label className="field-label">Fecha de inicio<input name="start_date" type="date" /></label>}
                <label className="field-label">{kind === "milestone" ? "Fecha del hito" : "Fecha límite"}<div className="input-icon"><CalendarDays size={16} /><input name="due_date" type="date" /></div></label>
              </div>
              <div className="multi-assignee-field quick-assignee-field"><span>Responsables</span><div>{quickMembers.map((member) => { const selected = selectedQuickAssignees.includes(member.user_id); return <button type="button" className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleQuickAssignee(member.user_id)} key={member.user_id}><i>{member.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"}</i><b>{member.full_name || member.email}</b><Check size={12} /></button>; })}{!quickMembers.length && <small>No hay integrantes ni responsables guardados.</small>}</div><label className="new-project-assignee"><span>Agregar responsable del proyecto</span><input value={newQuickAssignee} onChange={(event) => setNewQuickAssignee(event.target.value)} placeholder="Nombre de proveedor, contacto o apoyo" /><small>Quedará disponible para las próximas tareas.</small></label></div>
            </>}

            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving || sectionSaving}>{saving ? "Guardando..." : `Crear ${kind === "project" ? "proyecto" : kind === "milestone" ? "hito" : "tarea"}`}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
