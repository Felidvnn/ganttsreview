"use client";

import { CalendarRange, Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/types";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export function ProjectDetailsEditor({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [startDate, setStartDate] = useState(project.startDate || "");
  const [dueDate, setDueDate] = useState(project.dueDate || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName(project.name);
    setStartDate(project.startDate || "");
    setDueDate(project.dueDate || "");
    setError("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("El proyecto debe tener un nombre.");
      return;
    }
    if (startDate && dueDate && dueDate < startDate) {
      setError("La fecha de término no puede ser anterior al inicio.");
      return;
    }
    if (!hasSupabaseConfig) {
      setError("Esta acción necesita una conexión activa con Supabase.");
      return;
    }

    setBusy(true);
    setError("");
    const { error: saveError } = await createClient()!.rpc("update_project_details", {
      target_project: project.id,
      project_name: cleanName,
      project_start: startDate || null,
      project_due: dueDate || null,
    });
    if (saveError) {
      setError(saveError.code === "PGRST202"
        ? "Falta aplicar la migración 202607240024_project_details_health.sql en Supabase."
        : saveError.message);
      setBusy(false);
      return;
    }

    setOpen(false);
    setBusy(false);
    router.refresh();
  };

  return <>
    <button className="button secondary project-details-trigger" onClick={() => setOpen(true)}><Pencil size={15} /> Editar</button>
    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Editar proyecto">
      <button className="modal-backdrop" onClick={close} aria-label="Cerrar" />
      <form className="modal-card project-details-modal" onSubmit={save}>
        <div className="modal-head"><div><span className="eyebrow">DATOS DEL PROYECTO</span><h2>Editar proyecto</h2><p>Cambia su nombre o periodo sin alterar la planificación ni su historial.</p></div><button type="button" className="icon-button" onClick={close}><X size={19} /></button></div>
        <label className="field-label">Nombre del proyecto<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></label>
        <div className="project-date-editor">
          <label className="field-label"><span><CalendarRange size={14} /> Fecha de inicio</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field-label"><span><CalendarRange size={14} /> Fecha de término</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        </div>
        <p className="project-details-safety"><Check size={14} /> Solo se actualizan estos tres datos. Las tareas, notas, integrantes, atrasos y líneas base permanecen intactos.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
      </form>
    </div>}
  </>;
}
