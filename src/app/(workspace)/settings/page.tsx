"use client";

import { Bell, Building2, Check, KeyRound, Palette, Save, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [timezone, setTimezone] = useState("America/Santiago");
  const [role, setRole] = useState<"Líder" | "Ingeniero">("Ingeniero");
  useEffect(() => {
    const load = async () => {
      const supabase = createClient()!;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Tu sesión expiró. Vuelve a iniciar sesión."); setLoading(false); return; }
      setUserId(user.id); setEmail(user.email || "");
      const [profileResult, membershipResult] = await Promise.all([
        supabase.from("profiles").select("full_name,job_title,timezone").eq("id", user.id).maybeSingle(),
        supabase.from("workspace_members").select("role").eq("user_id", user.id).limit(1).maybeSingle(),
      ]);
      const data = profileResult.data;
      setName(data?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "");
      setJobTitle(data?.job_title || ""); setTimezone(data?.timezone || "America/Santiago"); setLoading(false);
      setRole(membershipResult.data?.role === "leader" ? "Líder" : "Ingeniero");
    };
    load();
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const { error: updateError } = await createClient()!.from("profiles").update({ full_name: name, job_title: jobTitle, timezone }).eq("id", userId);
    if (updateError) { setError(updateError.message); return; }
    setSaved(true); router.refresh(); setTimeout(() => setSaved(false), 1800);
  };
  const initials = name.split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]).join("").toUpperCase() || "U";
  return (
    <div className="settings-page">
      <section className="page-heading"><span className="eyebrow">PREFERENCIAS</span><h2>Configuración</h2><p>Administra tu perfil y el espacio de trabajo.</p></section>
      <div className="settings-layout">
        <nav className="settings-nav"><button className="active"><UserRound /> Perfil</button><button disabled title="Disponible próximamente"><Building2 /> Organización</button><button disabled title="Disponible próximamente"><Bell /> Notificaciones</button><button disabled title="Disponible próximamente"><ShieldCheck /> Roles y permisos</button><button disabled title="Disponible próximamente"><Palette /> Apariencia</button><button disabled title="Disponible próximamente"><KeyRound /> Seguridad</button></nav>
        <form className="panel settings-form" onSubmit={save}>
          <div className="settings-section-head"><div><h3>Información personal</h3><p>Así te verán los demás integrantes.</p></div><Avatar person={{ id: userId, name, initials, role, color: "#245f55" }} size="lg" /></div>
          <label className="field-label">Nombre completo<input value={name} onChange={(event) => setName(event.target.value)} disabled={loading} required /></label>
          <label className="field-label">Correo de acceso<input value={email} disabled /></label>
          <div className="form-grid"><label className="field-label">Cargo<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Ej. Ingeniero de proyectos" /></label><label className="field-label">Zona horaria<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="America/Santiago">Santiago</option><option value="America/Argentina/Buenos_Aires">Buenos Aires</option><option value="America/Lima">Lima</option></select></label></div>
          <hr /><div><h3>Preferencias de planificación <span className="coming-soon">PRÓXIMAMENTE</span></h3><p className="settings-help">Estas opciones se habilitarán cuando el calendario laboral esté conectado a la Gantt.</p></div>
          <div className="form-grid"><label className="field-label">Primer día de la semana<select disabled><option>Lunes</option></select></label><label className="field-label">Horas laborales por día<input type="number" defaultValue="8" disabled /></label></div>
          <label className="switch-row disabled"><span><b>Excluir fines de semana</b><small>No se considerarán días laborables en la Gantt.</small></span><input type="checkbox" defaultChecked disabled /><i /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="settings-actions"><button className="button primary" disabled={loading}><Save size={16} /> {saved ? "Guardado" : "Guardar cambios"}{saved && <Check size={15} />}</button></div>
        </form>
      </div>
    </div>
  );
}
