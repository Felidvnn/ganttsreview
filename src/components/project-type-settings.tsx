"use client";

import { Plus, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectTaskType } from "@/lib/task-types";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export function ProjectTypeSettings({ projectId, options, open, onClose, onSaved }: {
  projectId: string;
  options: ProjectTaskType[];
  open: boolean;
  onClose: () => void;
  onSaved: (options: ProjectTaskType[]) => void;
}) {
  const [draft, setDraft] = useState(options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setDraft(options); setError(""); } }, [open, options]);
  if (!open) return null;

  const addType = () => setDraft((current) => [...current, {
    id: `new-${crypto.randomUUID()}`, name: "Nuevo tipo", color: "#6B7D75", sortOrder: (current.length + 1) * 10,
  }]);

  const save = async () => {
    const clean = draft.map((item, index) => ({ ...item, name: item.name.trim(), sortOrder: (index + 1) * 10 }));
    if (!clean.length || clean.some((item) => !item.name)) { setError("Mantén al menos un tipo con nombre."); return; }
    if (new Set(clean.map((item) => item.name.toLocaleLowerCase("es"))).size !== clean.length) { setError("No repitas nombres de tipos."); return; }
    setBusy(true); setError("");
    if (hasSupabaseConfig) {
      const { error: saveError } = await createClient()!.rpc("configure_project_task_types", {
        target_project: projectId,
        type_configuration: clean.map((item) => ({ ...item, id: item.id.startsWith("new-") ? null : item.id })),
      });
      if (saveError) { setError(saveError.code === "PGRST202" ? "Falta aplicar la migración 202607200018_flexible_dates_task_types_import.sql." : saveError.message); setBusy(false); return; }
      const { data, error: reloadError } = await createClient()!.from("project_task_types").select("id,name,color,sort_order").eq("project_id", projectId).order("sort_order");
      if (reloadError) { setError(reloadError.message); setBusy(false); return; }
      onSaved((data || []).map((item) => ({ id: item.id, name: item.name, color: item.color, sortOrder: item.sort_order })));
    } else onSaved(clean);
    setBusy(false); onClose();
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Tipos de tarea del proyecto">
    <button className="modal-backdrop" onClick={onClose} />
    <section className="modal-card status-settings-modal task-type-settings-modal">
      <header className="modal-head"><div><span className="eyebrow">CLASIFICACIÓN DEL PROYECTO</span><h2>Tipos de tarea</h2><p>Crea las categorías que utiliza tu planificación, como proceso, reunión, entregable o inspección.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
      <div className="task-type-settings-list">{draft.map((item, index) => <article key={item.id}>
        <input type="color" value={item.color} onChange={(event) => setDraft((current) => current.map((type) => type.id === item.id ? { ...type, color: event.target.value } : type))} aria-label={`Color de ${item.name}`} />
        <label><span>Tipo {index + 1}</span><input value={item.name} maxLength={50} onChange={(event) => setDraft((current) => current.map((type) => type.id === item.id ? { ...type, name: event.target.value } : type))} /></label>
        <button type="button" className="icon-button danger-button" onClick={() => setDraft((current) => current.filter((type) => type.id !== item.id))} disabled={draft.length === 1} title="Eliminar tipo"><Trash2 size={14} /></button>
      </article>)}</div>
      <button type="button" className="button secondary task-type-add" onClick={addType}><Plus size={14} /> Agregar tipo</button>
      {error && <p className="form-error">{error}</p>}
      <footer className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" onClick={save} disabled={busy}><Settings2 size={15} />{busy ? "Guardando…" : "Guardar tipos"}</button></footer>
    </section>
  </div>;
}
