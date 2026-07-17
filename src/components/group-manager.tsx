"use client";

import {
  ArrowRightLeft, Check, Clock3, Copy, Crown, LogOut, MailPlus, Plus, ShieldCheck,
  ShieldOff, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupData, GroupPerson } from "@/lib/supabase/group-data";
import { createClient } from "@/lib/supabase/client";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function GroupAvatar({ member }: { member: Pick<GroupPerson, "name" | "role"> }) {
  return <span className={`group-avatar ${member.role === "leader" ? "leader" : ""}`}>{initials(member.name)}</span>;
}

export function GroupManager({ data }: { data: GroupData }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [groupName, setGroupName] = useState("");
  const [leaderEmail, setLeaderEmail] = useState("");
  const [successorId, setSuccessorId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const run = async (key: string, callback: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setBusy(key); setMessage(null);
    const { error } = await callback();
    if (error) setMessage({ type: "error", text: error.message });
    else { setMessage({ type: "ok", text: success }); router.refresh(); }
    setBusy(null);
  };

  if (data.migrationRequired) {
    return <section className="panel group-migration"><ShieldCheck /><h2>Falta aplicar la migración de grupos</h2><p>Ejecuta <code>202607140002_groups_invitations.sql</code> en el SQL Editor de Supabase y recarga esta página.</p></section>;
  }

  if (!data.currentUser) {
    return <section className="panel group-migration"><Users /><h2>Sesión no disponible</h2><p>Vuelve a iniciar sesión para administrar tu grupo.</p></section>;
  }

  const supabase = createClient()!;
  const pendingInvite = !data.group ? data.invitations.find((item) => item.kind === "invitation" && item.subject.id === data.currentUser!.id) : null;

  if (!data.group || !data.membership) {
    const createGroup = (event: React.FormEvent) => {
      event.preventDefault();
      const slug = `${groupName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now().toString().slice(-5)}`;
      run("create", () => supabase.rpc("create_workspace", { workspace_name: groupName, workspace_slug: slug }), "Grupo creado correctamente.");
    };
    const requestJoin = (event: React.FormEvent) => {
      event.preventDefault();
      run("join", () => supabase.rpc("request_to_join_group", { leader_email: leaderEmail }), "Solicitud enviada al líder.");
    };
    return <div className="group-onboarding">
      <section className="page-heading"><span className="eyebrow">TU EQUIPO</span><h2>Crea o únete a un grupo</h2><p>Los proyectos y permisos se organizan alrededor de tu grupo de trabajo.</p></section>
      {message && <div className={`group-message ${message.type}`}>{message.type === "ok" ? <Check /> : <X />}{message.text}</div>}
      {pendingInvite && <section className="panel pending-invite-card"><span className="metric-icon green"><MailPlus /></span><div><span className="eyebrow">INVITACIÓN PENDIENTE</span><h3>{pendingInvite.initiator.name} te invitó a su grupo</h3><p>{pendingInvite.initiator.email}</p></div><div><button className="button secondary" onClick={() => run(pendingInvite.id, () => supabase.rpc("respond_group_invitation", { target_invitation: pendingInvite.id, accept_invitation: false }), "Invitación rechazada.")}>Rechazar</button><button className="button primary" onClick={() => run(pendingInvite.id, () => supabase.rpc("respond_group_invitation", { target_invitation: pendingInvite.id, accept_invitation: true }), "Ya perteneces al grupo.")}>Aceptar</button></div></section>}
      <div className="group-onboarding-grid">
        <form className="panel onboarding-option" onSubmit={createGroup}><span className="group-option-icon"><Plus /></span><span className="eyebrow">PARA LÍDERES</span><h3>Crear un grupo</h3><p>Crea el espacio de tu equipo e invita a tus ingenieros.</p><label className="field-label">Nombre del grupo<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Ej. Ingeniería D2" required /></label><button className="button primary" disabled={busy === "create"}>{busy === "create" ? "Creando..." : "Crear grupo"}</button></form>
        <form className="panel onboarding-option" onSubmit={requestJoin}><span className="group-option-icon secondary"><UserPlus /></span><span className="eyebrow">PARA INGENIEROS</span><h3>Unirme a mi líder</h3><p>Ingresa el correo de tu líder y espera su aprobación.</p><label className="field-label">Correo del líder<input type="email" value={leaderEmail} onChange={(event) => setLeaderEmail(event.target.value)} placeholder="lider@empresa.cl" required /></label><button className="button secondary" disabled={busy === "join"}>{busy === "join" ? "Enviando..." : "Solicitar acceso"}</button></form>
      </div>
    </div>;
  }

  const isLeader = data.membership.role === "leader";
  const isAdmin = data.membership.isAdmin;
  const activeRequests = data.invitations.filter((item) => item.kind === "join_request");
  const activeInvites = data.invitations.filter((item) => item.kind === "invitation");
  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    run("invite", () => supabase.rpc("invite_group_member", { target_workspace: data.group!.id, target_email: email }), "Invitación enviada.");
  };
  const respond = (id: string, accept: boolean) => run(id, () => supabase.rpc("respond_group_invitation", { target_invitation: id, accept_invitation: accept }), accept ? "Integrante incorporado." : "Solicitud rechazada.");
  const toggleAdmin = (member: GroupPerson) => run(`admin-${member.id}`, () => supabase.rpc("set_group_admin", { target_workspace: data.group!.id, target_user: member.id, admin_enabled: !member.isAdmin }), member.isAdmin ? "Permiso de administrador retirado." : "Administrador asignado.");
  const remove = (member: GroupPerson) => {
    if (!window.confirm(`¿Eliminar a ${member.name} del grupo? Sus proyectos no se borrarán.`)) return;
    run(`remove-${member.id}`, () => supabase.rpc("remove_group_member", { target_workspace: data.group!.id, target_user: member.id }), "Integrante eliminado del grupo.");
  };
  const engineers = data.members.filter((member) => member.role === "engineer" && member.id !== data.currentUser!.id);
  const leave = () => {
    if (isLeader && !successorId) { setMessage({ type: "error", text: "Selecciona a un ingeniero para transferir el liderazgo." }); return; }
    const prompt = isLeader ? "¿Transferir el liderazgo y salir del grupo?" : "¿Salir de este grupo? Tus proyectos propios se conservarán.";
    if (!window.confirm(prompt)) return;
    run("leave", () => supabase.rpc("leave_group", { target_workspace: data.group!.id, target_successor: isLeader ? successorId : null }), "Saliste del grupo.");
  };

  return <>
    <section className="page-heading inline-heading group-heading"><div><span className="eyebrow">GRUPO DE TRABAJO</span><h2>{data.group.name}</h2><p>{data.members.length} integrantes · Tú eres {isLeader ? "líder" : "ingeniero"}{isAdmin && !isLeader ? " y administrador" : ""}</p></div><button className="button secondary" onClick={() => navigator.clipboard.writeText(data.group!.name)}><Copy size={16} /> Copiar nombre</button></section>
    {message && <div className={`group-message ${message.type}`}>{message.type === "ok" ? <Check /> : <X />}{message.text}</div>}

    <section className="group-summary-grid">
      <article className="panel group-stat"><span className="metric-icon green"><Users /></span><div><small>INTEGRANTES</small><b>{data.members.length}</b><p>{data.members.filter((member) => member.role === "engineer").length} ingenieros</p></div></article>
      <article className="panel group-stat"><span className="metric-icon violet"><ShieldCheck /></span><div><small>ADMINISTRADORES</small><b>{data.members.filter((member) => member.isAdmin).length}</b><p>Gestionan integrantes</p></div></article>
      <article className="panel group-stat"><span className="metric-icon amber"><Clock3 /></span><div><small>SOLICITUDES</small><b>{activeRequests.length}</b><p>Pendientes de revisión</p></div></article>
    </section>

    {isAdmin && <section className="panel invite-panel"><div><span className="metric-icon green"><MailPlus /></span><div><span className="eyebrow">INVITAR AL GRUPO</span><h3>Agrega un integrante por correo</h3><p>La persona debe tener una cuenta en Orbit y aceptar la invitación.</p></div></div><form onSubmit={invite}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ingeniero@empresa.cl" required /><button className="button primary" disabled={busy === "invite"}>{busy === "invite" ? "Enviando..." : "Enviar invitación"}</button></form></section>}

    {isAdmin && activeRequests.length > 0 && <section className="panel group-requests"><div className="panel-head"><div><span className="eyebrow">SOLICITUDES</span><h3>Personas que quieren unirse</h3></div><span className="request-count">{activeRequests.length}</span></div>{activeRequests.map((item) => <div className="request-row" key={item.id}><GroupAvatar member={{ name: item.subject.name, role: "engineer" }} /><span><b>{item.subject.name}</b><small>{item.subject.email} · solicitó unirse</small></span><div><button className="button secondary" disabled={busy === item.id} onClick={() => respond(item.id, false)}>Rechazar</button><button className="button primary" disabled={busy === item.id} onClick={() => respond(item.id, true)}>Aceptar</button></div></div>)}</section>}

    <section className="panel group-members-panel"><div className="panel-head"><div><span className="eyebrow">INTEGRANTES</span><h3>Personas de {data.group.name}</h3></div>{isAdmin && <span className="admin-hint"><ShieldCheck size={14} /> Administración habilitada</span>}</div><div className="group-member-list">{data.members.map((member) => <div className="group-member-row" key={member.id}><GroupAvatar member={member} /><span className="member-identity"><b>{member.name}{member.id === data.currentUser!.id && <em>Tú</em>}</b><small>{member.email || member.jobTitle}</small></span><span className={`role-chip ${member.role}`}>{member.role === "leader" ? <Crown size={12} /> : <Users size={12} />}{member.role === "leader" ? "Líder" : "Ingeniero"}</span>{member.isAdmin && <span className="admin-chip"><ShieldCheck size={12} /> Admin</span>}<span className="joined-date">Desde {new Intl.DateTimeFormat("es-CL", { month: "short", year: "numeric" }).format(new Date(member.joinedAt))}</span><div className="member-actions">{isLeader && member.role === "engineer" && member.id !== data.currentUser!.id && <button className="icon-button" title={member.isAdmin ? "Quitar administrador" : "Hacer administrador"} disabled={busy === `admin-${member.id}`} onClick={() => toggleAdmin(member)}>{member.isAdmin ? <ShieldOff size={17} /> : <ShieldCheck size={17} />}</button>}{isAdmin && member.role !== "leader" && member.id !== data.currentUser!.id && <button className="icon-button danger-button" title="Eliminar del grupo" disabled={busy === `remove-${member.id}`} onClick={() => remove(member)}><Trash2 size={17} /></button>}</div></div>)}</div></section>

    {activeInvites.length > 0 && <section className="panel sent-invitations"><div className="panel-head"><div><span className="eyebrow">INVITACIONES</span><h3>Pendientes de respuesta</h3></div></div>{activeInvites.map((item) => <div className="request-row" key={item.id}><GroupAvatar member={{ name: item.subject.name, role: "engineer" }} /><span><b>{item.subject.name}</b><small>{item.subject.email}</small></span><span className="waiting-chip"><Clock3 size={12} /> Esperando respuesta</span>{isAdmin && <button className="icon-button" title="Cancelar" onClick={() => run(item.id, () => supabase.rpc("cancel_group_invitation", { target_invitation: item.id }), "Invitación cancelada.")}><X size={17} /></button>}</div>)}</section>}

    {isLeader ? <section className="panel group-exit-panel"><div><span className="metric-icon amber"><ArrowRightLeft /></span><div><span className="eyebrow">CAMBIAR DE GRUPO</span><h3>Transferir liderazgo y salir</h3><p>Tus proyectos se conservarán. Los compartidos con este líder volverán a privados.</p></div></div>{engineers.length ? <div className="group-exit-actions"><select value={successorId} onChange={(event) => setSuccessorId(event.target.value)}><option value="">Selecciona nuevo líder</option>{engineers.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select><button className="button danger-outline" disabled={busy === "leave"} onClick={leave}><LogOut size={14} /> Transferir y salir</button></div> : <small>Necesitas al menos un ingeniero en el grupo antes de poder transferirlo.</small>}</section> : <button className="leave-group" disabled={busy === "leave"} onClick={leave}><LogOut size={15} /> Salir de este grupo</button>}
  </>;
}
