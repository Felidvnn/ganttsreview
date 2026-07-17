"use client";

import { Check, Eye, Pencil, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Person } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";

export function ProjectSharing({ projectId, members }: { projectId: string; members: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const share = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    const { error } = await createClient()!.rpc("share_project_with_email", { target_project: projectId, target_email: email, target_permission: permission });
    if (error) setMessage({ ok: false, text: error.message });
    else { setMessage({ ok: true, text: "Acceso actualizado." }); setEmail(""); router.refresh(); }
    setBusy(false);
  };
  const remove = async (member: Person) => {
    if (!window.confirm(`¿Quitar a ${member.name} de este proyecto?`)) return;
    setBusy(true);
    const { error } = await createClient()!.rpc("remove_project_collaborator", { target_project: projectId, target_user: member.id });
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Colaborador eliminado." });
    if (!error) router.refresh();
    setBusy(false);
  };

  return <>
    <button className="button secondary" onClick={() => setOpen(true)}><Share2 size={16} /> Compartir</button>
    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Compartir proyecto"><button className="modal-backdrop" onClick={() => setOpen(false)} aria-label="Cerrar" /><section className="modal-card share-modal"><div className="modal-head"><div><span className="eyebrow">COLABORACIÓN</span><h2>Compartir proyecto</h2><p>La persona debe pertenecer a tu grupo.</p></div><button className="icon-button" onClick={() => setOpen(false)}><X size={19} /></button></div><form onSubmit={share} className="share-form"><label className="field-label">Correo del integrante<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@empresa.cl" required /></label><div className="share-permissions"><button type="button" className={permission === "editor" ? "selected" : ""} onClick={() => setPermission("editor")}><Pencil /><span><b>Puede editar</b><small>Gestiona tareas y planificación</small></span></button><button type="button" className={permission === "viewer" ? "selected" : ""} onClick={() => setPermission("viewer")}><Eye /><span><b>Solo lectura</b><small>Consulta sin hacer cambios</small></span></button></div>{message && <div className={`share-message ${message.ok ? "ok" : "error"}`}>{message.ok ? <Check /> : <X />}{message.text}</div>}<button className="button primary" disabled={busy}>{busy ? "Guardando..." : "Compartir acceso"}</button></form><div className="share-members"><span className="eyebrow">CON ACCESO · {members.length}</span>{members.map((member) => <div key={member.id}><Avatar person={member} size="sm" /><span><b>{member.name}</b><small>{member.email || (member.permission === "owner" ? "Propietario" : member.permission === "editor" ? "Puede editar" : "Solo lectura")}</small></span><span className={`permission-label permission-${member.permission}`}>{member.permission === "owner" ? "Propietario" : member.permission === "editor" ? "Editor" : "Lector"}</span>{member.permission !== "owner" && <button className="icon-button danger-button" disabled={busy} onClick={() => remove(member)}><Trash2 size={15} /></button>}</div>)}</div></section></div>}
  </>;
}
