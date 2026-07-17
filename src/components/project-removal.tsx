"use client";

import { AlertTriangle, LogOut, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export function ProjectRemoval({ projectId, projectName, isOwner }: {
  projectId: string;
  projectName: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = confirmation.trim().toLocaleLowerCase("es") === projectName.trim().toLocaleLowerCase("es");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirmation("");
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isOwner && !confirmed) return;
    if (!hasSupabaseConfig) {
      setError("Esta acción necesita una conexión activa con Supabase.");
      return;
    }

    setBusy(true);
    setError("");
    const supabase = createClient()!;
    const { error: actionError } = isOwner
      ? await supabase.rpc("delete_owned_project", { target_project: projectId, confirmation_text: confirmation })
      : await supabase.rpc("remove_my_project_access", { target_project: projectId });

    if (actionError) {
      setError(actionError.code === "PGRST202"
        ? "Falta aplicar la migración 202607170013_safe_group_project_removal.sql en Supabase."
        : actionError.message);
      setBusy(false);
      return;
    }

    router.replace("/projects");
    router.refresh();
  };

  return <>
    <button className={`button secondary project-removal-trigger ${isOwner ? "owner" : "access"}`} onClick={() => setOpen(true)}>
      {isOwner ? <Trash2 size={15} /> : <LogOut size={15} />}
      {isOwner ? "Eliminar proyecto" : "Quitar de mis proyectos"}
    </button>

    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={isOwner ? "Eliminar proyecto" : "Quitar acceso al proyecto"}>
      <button className="modal-backdrop" onClick={close} aria-label="Cerrar" />
      <form className="modal-card project-removal-modal" onSubmit={submit}>
        <div className="modal-head"><div><span className="eyebrow">{isOwner ? "ELIMINACIÓN DEFINITIVA" : "TU ACCESO"}</span><h2>{isOwner ? "Eliminar proyecto" : "Quitar de mis proyectos"}</h2></div><button type="button" className="icon-button" onClick={close}><X size={18} /></button></div>

        <div className={`project-removal-warning ${isOwner ? "danger" : "safe"}`}>
          <span>{isOwner ? <AlertTriangle /> : <LogOut />}</span>
          <div><b>{isOwner ? "Esta acción sí elimina el proyecto" : "El proyecto seguirá intacto"}</b><p>{isOwner ? "Se borrarán su Gantt, tareas, notas y relaciones. Solo el propietario real puede realizar esta acción." : "Solo se retirará tu acceso. El propietario y los demás colaboradores conservarán toda la información."}</p></div>
        </div>

        {isOwner && <label className="field-label project-confirmation">Para confirmar, escribe <b>{projectName}</b><input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder={projectName} /></label>}
        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button className="button danger-solid" disabled={busy || (isOwner && !confirmed)}>{busy ? "Procesando…" : isOwner ? "Eliminar definitivamente" : "Quitar mi acceso"}</button></div>
      </form>
    </div>}
  </>;
}
