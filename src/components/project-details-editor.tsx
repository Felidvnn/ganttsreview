"use client";

import { CalendarRange, Check, Pencil, Timer, TrendingDown, X } from "lucide-react";
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
  const [capturableName, setCapturableName] = useState(project.capturableName || "");
  const [reductionPercent, setReductionPercent] = useState(project.capturableReductionPercent?.toString() || "");
  const [hhtTransformed, setHhtTransformed] = useState(project.hhtTransformed?.toString() || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName(project.name);
    setStartDate(project.startDate || "");
    setDueDate(project.dueDate || "");
    setCapturableName(project.capturableName || "");
    setReductionPercent(project.capturableReductionPercent?.toString() || "");
    setHhtTransformed(project.hhtTransformed?.toString() || "");
    setError("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const reductionValue = reductionPercent === "" ? null : Number(reductionPercent);
    const hhtValue = hhtTransformed === "" ? null : Number(hhtTransformed);

    if (!cleanName) {
      setError("El proyecto debe tener un nombre.");
      return;
    }
    if (startDate && dueDate && dueDate < startDate) {
      setError("La fecha de término no puede ser anterior al inicio.");
      return;
    }
    if (reductionValue !== null && (!Number.isFinite(reductionValue) || reductionValue < 0 || reductionValue > 100)) {
      setError("La reducción debe estar entre 0 y 100%.");
      return;
    }
    if (hhtValue !== null && (!Number.isFinite(hhtValue) || hhtValue < 0)) {
      setError("Las HHT transformadas no pueden ser negativas.");
      return;
    }
    if (!hasSupabaseConfig) {
      setError("Esta acción necesita una conexión activa con Supabase.");
      return;
    }

    setBusy(true);
    setError("");
    const supabase = createClient()!;
    const { error: detailsError } = await supabase.rpc("update_project_details", {
      target_project: project.id,
      project_name: cleanName,
      project_start: startDate || null,
      project_due: dueDate || null,
    });
    if (detailsError) {
      setError(detailsError.code === "PGRST202"
        ? "Falta aplicar la migración 202607240024_project_details_health.sql en Supabase."
        : detailsError.message);
      setBusy(false);
      return;
    }

    const { error: impactError } = await supabase.rpc("update_project_impact", {
      target_project: project.id,
      capturable_label: capturableName.trim() || null,
      reduction_percent: reductionValue,
      transformed_hht: hhtValue,
    });
    if (impactError) {
      setError(impactError.code === "PGRST202"
        ? "Falta aplicar la migración 202607270026_project_impact_business_case.sql en Supabase."
        : impactError.message);
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
        <div className="modal-head"><div><span className="eyebrow">DATOS DEL PROYECTO</span><h2>Editar proyecto</h2><p>Cambia sus datos e indicadores de impacto sin alterar la planificación ni su historial.</p></div><button type="button" className="icon-button" onClick={close}><X size={19} /></button></div>
        <label className="field-label">Nombre del proyecto<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></label>
        <div className="project-date-editor">
          <label className="field-label"><span><CalendarRange size={14} /> Fecha de inicio</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field-label"><span><CalendarRange size={14} /> Fecha de término</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        </div>
        <div className="project-impact-editor">
          <div className="project-impact-editor-title"><TrendingDown size={15} /><span><b>Capturable</b><small>Qué indicador buscas reducir y en qué proporción.</small></span></div>
          <div className="project-impact-editor-fields">
            <label className="field-label">Indicador<input value={capturableName} onChange={(event) => setCapturableName(event.target.value)} maxLength={120} placeholder="Ej. Tiempo de respuesta" /></label>
            <label className="field-label">Reducción esperada (%)<input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={reductionPercent} onChange={(event) => setReductionPercent(event.target.value)} placeholder="Ej. 15" disabled={!capturableName.trim()} /></label>
          </div>
          <label className="field-label project-hht-field"><span><Timer size={14} /> HHT transformadas</span><input type="number" inputMode="decimal" min="0" step="0.01" value={hhtTransformed} onChange={(event) => setHhtTransformed(event.target.value)} placeholder="Ej. 240" /></label>
        </div>
        <p className="project-details-safety"><Check size={14} /> Estos indicadores son opcionales. Las tareas, notas, integrantes, atrasos y líneas base permanecen intactos.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
      </form>
    </div>}
  </>;
}
