"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Link2, MessageSquareText, Plus, Trash2, UsersRound, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type NoteCategory = "general" | "meeting" | "progress" | "decision";
type ProjectNote = { id: string; project_id: string; author_id: string; title: string; category: NoteCategory; body: string; mentioned_task_ids: string[]; linked_followup_id: string | null; linked_delay_id: string | null; created_at: string; profiles?: { full_name: string } | { full_name: string }[] | null };
type LinkOption = { id: string; label: string };
const categoryLabels: Record<NoteCategory, string> = { general: "Nota general", meeting: "Reunión", progress: "Avance", decision: "Decisión" };

export function ProjectNotes({ projectId, tasks, canEdit, onNavigate, onOpenTask }: {
  projectId: string;
  tasks: Task[];
  canEdit: boolean;
  onNavigate: (view: "delays" | "followups") => void;
  onOpenTask: (task: Task) => void;
}) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [followups, setFollowups] = useState<LinkOption[]>([]);
  const [delays, setDelays] = useState<LinkOption[]>([]);
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NoteCategory>("general");
  const [mentionedTaskIds, setMentionedTaskIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<"none" | "followup" | "delay">("none");
  const [linkId, setLinkId] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newBlocker, setNewBlocker] = useState(false);
  const [delayTaskId, setDelayTaskId] = useState("");
  const [delayDays, setDelayDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!hasSupabaseConfig) { setLoading(false); return; }
    const supabase = createClient()!; setLoading(true);
    const [auth, noteResult, followupResult, delayResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("project_notes").select("id,project_id,author_id,title,category,body,mentioned_task_ids,linked_followup_id,linked_delay_id,created_at,profiles!project_notes_author_id_fkey(full_name)").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("project_followups").select("id,title,status").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("task_delay_records").select("id,reason,tasks!inner(title,project_id)").eq("tasks.project_id", projectId).order("occurred_on", { ascending: false }),
    ]);
    if (auth.data.user) setUserId(auth.data.user.id);
    if (noteResult.error) setError(noteResult.error.code === "42P01" || noteResult.error.code === "PGRST205" || noteResult.error.code === "42703" ? "Falta aplicar la migración 202607200022_project_note_mentions.sql." : noteResult.error.message);
    else setNotes((noteResult.data || []) as unknown as ProjectNote[]);
    setFollowups((followupResult.data || []).map((item) => ({ id: item.id, label: `${item.title}${item.status === "done" ? " · completado" : ""}` })));
    setDelays((delayResult.data || []).map((item) => { const task = Array.isArray(item.tasks) ? item.tasks[0] : item.tasks; return { id: item.id, label: `${task?.title || "Tarea"} · ${item.reason}` }; }));
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!hasSupabaseConfig) return;
    const supabase = createClient()!;
    const channel = supabase.channel(`project-notes-${projectId}`).on("postgres_changes", { event: "*", schema: "public", table: "project_notes", filter: `project_id=eq.${projectId}` }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mentionMatches = useMemo(() => mentionQuery === null ? [] : tasks.filter((task) => !mentionedTaskIds.includes(task.id) && task.title.toLocaleLowerCase("es").includes(mentionQuery.toLocaleLowerCase("es"))).slice(0, 7), [mentionQuery, mentionedTaskIds, tasks]);
  const selectedMentions = mentionedTaskIds.map((id) => tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));
  const linkOptions = linkKind === "followup" ? followups : linkKind === "delay" ? delays : [];

  const updateBody = (nextBody: string) => {
    setBody(nextBody);
    const match = nextBody.match(/(?:^|\s)@([^@\n]*)$/);
    setMentionQuery(match ? match[1].trim() : null);
  };

  const mentionTask = (task: Task) => {
    const marker = body.lastIndexOf("@");
    setBody(`${marker >= 0 ? body.slice(0, marker) : body}@${task.title} `);
    setMentionedTaskIds((current) => current.includes(task.id) ? current : [...current, task.id]);
    setMentionQuery(null);
    if (!delayTaskId) setDelayTaskId(task.id);
  };

  const createContextLink = async () => {
    if (!hasSupabaseConfig || !canEdit || linkId !== "__new__") return null;
    const supabase = createClient()!;
    const origin = `Creado desde la nota “${title.trim()}”.\n\n${body.trim()}`;
    if (linkKind === "followup") {
      const { data, error: followupError } = await supabase.from("project_followups").insert({
        project_id: projectId, task_id: mentionedTaskIds[0] || null, title: title.trim(), notes: origin,
        owner_label: newOwner.trim() || null, due_date: newDueDate || null, status: "open",
        is_blocker: newBlocker, created_by: userId,
      }).select("id").single();
      if (followupError) throw followupError;
      return String(data.id);
    }
    const targetTask = delayTaskId || mentionedTaskIds[0];
    if (!targetTask) throw new Error("Selecciona la tarea afectada por el atraso.");
    const { data, error: delayError } = await supabase.rpc("save_task_delay", {
      target_task: targetTask, delay_reason: title.trim(), target_delay_days: delayDays,
      target_occurred_on: newDueDate || new Date().toISOString().slice(0, 10), delay_notes: origin,
    });
    if (delayError) throw delayError;
    return String(data);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!title.trim() || !body.trim() || !userId) return;
    setBusy(true); setError("");
    try {
      let selectedLink = linkId && linkId !== "__new__" ? linkId : null;
      if (linkId === "__new__") selectedLink = await createContextLink();
      if (hasSupabaseConfig) {
        const { data, error: saveError } = await createClient()!.from("project_notes").insert({
          project_id: projectId, author_id: userId, title: title.trim(), category, body: body.trim(), mentioned_task_ids: mentionedTaskIds,
          linked_followup_id: linkKind === "followup" ? selectedLink : null,
          linked_delay_id: linkKind === "delay" ? selectedLink : null,
        }).select("id,project_id,author_id,title,category,body,mentioned_task_ids,linked_followup_id,linked_delay_id,created_at,profiles!project_notes_author_id_fkey(full_name)").single();
        if (saveError) throw saveError;
        setNotes((current) => [data as unknown as ProjectNote, ...current.filter((item) => item.id !== data.id)]);
      }
      setTitle(""); setBody(""); setMentionedTaskIds([]); setMentionQuery(null); setLinkKind("none"); setLinkId(""); setNewDueDate(""); setNewOwner(""); setNewBlocker(false); setDelayTaskId(""); setDelayDays(1);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : "No se pudo publicar la nota."); }
    setBusy(false);
  };

  const remove = async (note: ProjectNote) => {
    if (!window.confirm("¿Eliminar esta nota del proyecto?")) return;
    if (hasSupabaseConfig) { const { error: removeError } = await createClient()!.from("project_notes").delete().eq("id", note.id); if (removeError) { setError(removeError.message); return; } }
    setNotes((current) => current.filter((item) => item.id !== note.id));
  };

  const authorName = (note: ProjectNote) => { const profile = Array.isArray(note.profiles) ? note.profiles[0] : note.profiles; return profile?.full_name || "Integrante del proyecto"; };

  return <section className="project-notes-view">
    <header className="project-notes-hero"><div><span className="eyebrow">BITÁCORA COLABORATIVA</span><h3>Notas del proyecto</h3><p>Registra reuniones, avances y decisiones. Escribe @ para citar tareas y conecta cada acuerdo con su seguimiento.</p></div><span><UsersRound size={18} /> Visible para el equipo</span></header>
    <form className="project-note-composer" onSubmit={save}>
      <input className="project-note-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Título de la nota o reunión" required />
      <label className="project-note-body"><MessageSquareText size={18} /><span><textarea value={body} onChange={(event) => updateBody(event.target.value)} rows={4} placeholder="Escribe acuerdos o avances. Usa @ para mencionar una tarea…" required />{mentionQuery !== null && <div className="note-mention-menu">{mentionMatches.map((task) => <button type="button" onClick={() => mentionTask(task)} key={task.id}><b>@{task.title}</b><small>{task.section} · {task.dueDate || "Sin fecha"}</small></button>)}{!mentionMatches.length && <span>No encontramos otra tarea con ese nombre.</span>}</div>}</span></label>
      {selectedMentions.length > 0 && <div className="note-mention-chips">{selectedMentions.map((task) => <span key={task.id}>@{task.title}<button type="button" onClick={() => setMentionedTaskIds((current) => current.filter((id) => id !== task.id))}><X size={11} /></button></span>)}</div>}
      <div className="project-note-controls"><select value={category} onChange={(event) => setCategory(event.target.value as NoteCategory)}><option value="general">Nota general</option><option value="meeting">Reunión</option><option value="progress">Avance</option><option value="decision">Decisión</option></select><select value={linkKind} onChange={(event) => { setLinkKind(event.target.value as typeof linkKind); setLinkId(""); }}><option value="none">Sin vínculo</option><option value="followup">Vincular pendiente</option><option value="delay">Vincular atraso</option></select>{linkKind !== "none" && <select value={linkId} onChange={(event) => setLinkId(event.target.value)} required><option value="">Seleccionar…</option>{linkOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}{canEdit && <option value="__new__">＋ Crear {linkKind === "followup" ? "pendiente" : "atraso"} desde esta nota</option>}</select>}<button className="button primary" disabled={busy || !title.trim() || !body.trim()}><Plus size={15} />{busy ? "Publicando…" : "Publicar nota"}</button></div>
      {linkId === "__new__" && linkKind === "followup" && <div className="note-inline-create"><div><b>Nuevo pendiente</b><span>Se creará usando el título y contenido de esta nota.</span></div><label>Vencimiento<input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} /></label><label>Responsable<input value={newOwner} onChange={(event) => setNewOwner(event.target.value)} placeholder="Nombre opcional" /></label><label className="note-blocker-check"><input type="checkbox" checked={newBlocker} onChange={(event) => setNewBlocker(event.target.checked)} /> Es bloqueo</label></div>}
      {linkId === "__new__" && linkKind === "delay" && <div className="note-inline-create"><div><b>Nuevo atraso</b><span>Quedará registrado como originado desde esta nota.</span></div><label>Tarea afectada<select value={delayTaskId || mentionedTaskIds[0] || ""} onChange={(event) => setDelayTaskId(event.target.value)} required><option value="">Seleccionar tarea…</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label><label>Días<input type="number" min={1} max={3650} value={delayDays} onChange={(event) => setDelayDays(Number(event.target.value))} required /></label><label>Fecha<input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} /></label></div>}
    </form>
    {error && <p className="form-error">{error}</p>}
    <div className="project-note-feed">{notes.map((note) => <article key={note.id}><span className={`note-category category-${note.category}`}>{note.category === "meeting" ? <UsersRound size={13} /> : note.category === "progress" ? <CheckCircle2 size={13} /> : note.category === "decision" ? <AlertTriangle size={13} /> : <MessageSquareText size={13} />}</span><div><header><b>{authorName(note)}</b><em>{categoryLabels[note.category]}</em><time>{format(new Date(note.created_at), "dd MMM yyyy · HH:mm", { locale: es })}</time></header><h4>{note.title || "Nota del proyecto"}</h4><p>{note.body}</p><div className="note-task-links">{(note.mentioned_task_ids || []).map((id) => { const task = tasks.find((item) => item.id === id); return task ? <button type="button" onClick={() => onOpenTask(task)} key={id}>@{task.title}</button> : null; })}</div><footer>{note.linked_followup_id && <button onClick={() => onNavigate("followups")}><Link2 size={12} /> Ver pendiente asociado</button>}{note.linked_delay_id && <button onClick={() => onNavigate("delays")}><CalendarClock size={12} /> Ver atraso asociado</button>}</footer></div>{note.author_id === userId && <button className="note-delete" onClick={() => remove(note)} title="Eliminar nota"><Trash2 size={14} /></button>}</article>)}{!notes.length && !loading && <div className="project-notes-empty"><MessageSquareText size={25} /><b>La bitácora está vacía</b><span>Publica la primera nota de reunión o avance del proyecto.</span></div>}{loading && <div className="project-notes-empty">Cargando notas…</div>}</div>
  </section>;
}
