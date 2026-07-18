"use client";

import { Check, Crown, Eye, LockKeyhole, Pencil, Share2, Trash2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Person, Project } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";

type VisibilityKey = Project["visibilityKey"];

export function ProjectSharing({ projectId, members, visibility }: { projectId: string; members: Person[]; visibility: VisibilityKey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityKey>(visibility);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const runWithFreshSession = async <T,>(operation: () => PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const supabase = createClient()!;
    let result = await operation();
    if (result.error?.message.includes("Solo el creador")) {
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.error) result = await operation();
    }
    return result;
  };

  const saveVisibility = async () => {
    setBusy(true); setMessage(null);
    const { error } = await runWithFreshSession(() => createClient()!.rpc("set_project_visibility", { target_project: projectId, next_visibility: selectedVisibility }));
    if (error) setMessage({ ok: false, text: error.message });
    else { setMessage({ ok: true, text: "Visibilidad actualizada." }); router.refresh(); }
    setBusy(false);
  };
  const share = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    const { error } = await runWithFreshSession(() => createClient()!.rpc("share_project_with_email", { target_project: projectId, target_email: email, target_permission: permission }));
    if (error) setMessage({ ok: false, text: error.message });
    else { setSelectedVisibility("workspace"); setMessage({ ok: true, text: "Acceso colaborativo guardado." }); setEmail(""); router.refresh(); }
    setBusy(false);
  };
  const remove = async (member: Person) => {
    if (!window.confirm(`¿Quitar a ${member.name} de este proyecto?`)) return;
    setBusy(true);
    const { error } = await runWithFreshSession(() => createClient()!.rpc("remove_project_collaborator", { target_project: projectId, target_user: member.id }));
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Colaborador eliminado." });
    if (!error) router.refresh();
    setBusy(false);
  };

  return <>
    <button className="button secondary" onClick={() => setOpen(true)}><Share2 size={16} /> Acceso</button>
    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Configurar acceso al proyecto"><button className="modal-backdrop" onClick={() => setOpen(false)} aria-label="Cerrar" /><section className="modal-card share-modal"><div className="modal-head"><div><span className="eyebrow">VISIBILIDAD Y COLABORACIÓN</span><h2>Acceso al proyecto</h2><p>Decide quién puede verlo y participar.</p></div><button className="icon-button" onClick={() => setOpen(false)}><X size={19} /></button></div>
      <div className="visibility-options">
        <button type="button" className={selectedVisibility === "private" ? "selected" : ""} onClick={() => setSelectedVisibility("private")}><LockKeyhole /><span><b>Privado</b><small>Solo tú puedes verlo; se revocan los accesos existentes.</small></span>{selectedVisibility === "private" && <Check />}</button>
        <button type="button" className={selectedVisibility === "shared" ? "selected" : ""} onClick={() => setSelectedVisibility("shared")}><Crown /><span><b>Con mi líder</b><small>Tu líder puede abrirlo y hacer seguimiento. Se revocan otros accesos.</small></span>{selectedVisibility === "shared" && <Check />}</button>
        <button type="button" className={selectedVisibility === "workspace" ? "selected" : ""} onClick={() => setSelectedVisibility("workspace")}><Users /><span><b>Colaborativo</b><small>Solo las personas que invites podrán participar.</small></span>{selectedVisibility === "workspace" && <Check />}</button>
      </div>
      <button className="button secondary visibility-save" onClick={saveVisibility} disabled={busy || selectedVisibility === visibility}>{busy ? "Guardando..." : "Guardar visibilidad"}</button>

      {selectedVisibility === "workspace" && <><form onSubmit={share} className="share-form"><label className="field-label">Correo de la persona<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@correo.cl" required /></label><div className="share-permissions"><button type="button" className={permission === "editor" ? "selected" : ""} onClick={() => setPermission("editor")}><Pencil /><span><b>Puede editar</b><small>Gestiona tareas y planificación</small></span></button><button type="button" className={permission === "viewer" ? "selected" : ""} onClick={() => setPermission("viewer")}><Eye /><span><b>Solo lectura</b><small>Consulta sin hacer cambios</small></span></button></div><button className="button primary" disabled={busy}>{busy ? "Guardando..." : "Invitar al proyecto"}</button></form><div className="share-members"><span className="eyebrow">CON ACCESO · {members.length}</span>{members.map((member) => <div key={member.id}><Avatar person={member} size="sm" /><span><b>{member.name}</b><small>{member.email || (member.permission === "owner" ? "Propietario" : member.permission === "editor" ? "Puede editar" : "Solo lectura")}</small></span><span className={`permission-label permission-${member.permission}`}>{member.permission === "owner" ? "Propietario" : member.permission === "editor" ? "Editor" : "Lector"}</span>{member.permission !== "owner" && <button className="icon-button danger-button" disabled={busy} onClick={() => remove(member)}><Trash2 size={15} /></button>}</div>)}</div></>}
      {message && <div className={`share-message ${message.ok ? "ok" : "error"}`}>{message.ok ? <Check /> : <X />}{message.text}</div>}
    </section></div>}
  </>;
}
