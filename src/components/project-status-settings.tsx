"use client";

import { Check, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectTaskStatus } from "@/lib/task-statuses";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export function ProjectStatusSettings({ projectId, options, open, onClose, onSaved }: {
  projectId: string;
  options: ProjectTaskStatus[];
  open: boolean;
  onClose: () => void;
  onSaved: (options: ProjectTaskStatus[]) => void;
}) {
  const [draft, setDraft] = useState(options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setDraft(options); setError(""); } }, [open, options]);
  if (!open) return null;

  const save = async () => {
    if (draft.filter((item) => item.enabled).length < 2) { setError("Mantén al menos dos estados activos."); return; }
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: saveError } = await createClient()!.rpc("configure_project_statuses", {
        target_project: projectId,
        status_configuration: draft,
      });
      if (saveError) {
        setError(saveError.code === "PGRST202" ? "Falta aplicar la migración 202607150008_project_statuses_privacy.sql." : saveError.message);
        setBusy(false); return;
      }
    }
    onSaved(draft); setBusy(false); onClose();
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Estados del proyecto">
    <button className="modal-backdrop" onClick={onClose} />
    <section className="modal-card status-settings-modal">
      <header className="modal-head"><div><span className="eyebrow">FLUJO DEL PROYECTO</span><h2>Estados de las tareas</h2><p>Activa solo las etapas que usa este proyecto y ponles nombres familiares para tu equipo.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
      <div className="status-settings-list">{draft.map((item, index) => <article className={item.enabled ? "enabled" : ""} key={item.status}>
        <button type="button" className="status-enabled" onClick={() => setDraft((current) => current.map((state) => state.status === item.status ? { ...state, enabled: !state.enabled } : state))} aria-label={item.enabled ? "Desactivar estado" : "Activar estado"}>{item.enabled && <Check size={13} />}</button>
        <input type="color" value={item.color} onChange={(event) => setDraft((current) => current.map((state) => state.status === item.status ? { ...state, color: event.target.value } : state))} />
        <label><span>Estado {index + 1}</span><input value={item.label} maxLength={40} onChange={(event) => setDraft((current) => current.map((state) => state.status === item.status ? { ...state, label: event.target.value } : state))} /></label>
      </article>)}</div>
      {error && <p className="form-error">{error}</p>}
      <footer className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" onClick={save} disabled={busy}><Settings2 size={15} />{busy ? "Guardando…" : "Guardar estados"}</button></footer>
    </section>
  </div>;
}
