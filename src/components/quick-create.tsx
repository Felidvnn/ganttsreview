"use client";

import { CalendarDays, CheckSquare2, FolderKanban, Milestone, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { projects as demoProjects } from "@/lib/demo-data";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type ProjectOption = { id: string; name: string };
const suggestedSections = ["General", "Planificación", "Ejecución", "Cierre"];

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
    };
    load();
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  const changeProject = (nextProject: string) => {
    setProjectId(nextProject);
    setSection(sectionsByProject[nextProject]?.[0] ?? "General");
    setAddingSection(false); setNewSectionDraft("");
  };

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
        const { error: insertError } = await supabase.rpc("create_project_with_sections", {
          target_workspace: membership.workspace_id,
          project_name: name,
          project_code: code,
          project_description: description,
          project_visibility: visibility,
          project_start: projectStart || null,
          project_due: projectDue || null,
          section_names: initialSections,
        });
        if (insertError) { setError(sectionErrorMessage(insertError.message, insertError.code)); setSaving(false); return; }
      } else {
        if (!projectId) { setError("Crea primero un proyecto para poder agregar tareas o hitos."); setSaving(false); return; }
        const dueDate = String(form.get("due_date") || "");
        const requestedStart = String(form.get("start_date") || "");
        const startDate = kind === "milestone" ? dueDate || new Date().toISOString().slice(0, 10) : requestedStart || new Date().toISOString().slice(0, 10);
        const { data: task, error: insertError } = await supabase.from("tasks").insert({
          project_id: projectId, title: name, section, start_date: startDate,
          due_date: dueDate || (kind === "milestone" ? startDate : null), is_milestone: kind === "milestone", created_by: user.id,
        }).select("id").single();
        if (insertError) { setError(insertError.message); setSaving(false); return; }
        await supabase.from("task_assignees").insert({ task_id: task.id, user_id: user.id, assigned_by: user.id });
      }
    }
    setCreated(true); router.refresh();
    setTimeout(() => {
      setCreated(false); setSaving(false); setName(""); setDescription(""); setProjectStart(""); setProjectDue("");
      setVisibility("private"); setInitialSections(suggestedSections); onClose();
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
            </>}

            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving || sectionSaving}>{saving ? "Guardando..." : `Crear ${kind === "project" ? "proyecto" : kind === "milestone" ? "hito" : "tarea"}`}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
