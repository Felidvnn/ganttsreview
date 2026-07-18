"use client";

import { ArrowRight, BarChart3, CheckCircle2, Eye, EyeOff, Heart, LockKeyhole, Network } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type AccessMode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AccessMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const changeMode = (nextMode: AccessMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    if (!hasSupabaseConfig) {
      setError("Supabase aún no está configurado. Puedes ingresar con el modo demostración.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient()!;
      if (mode === "signup") {
        if (fullName.trim().length < 2) {
          setError("Escribe tu nombre para crear la cuenta.");
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError("La contraseña debe tener al menos 8 caracteres.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Las contraseñas no coinciden.");
          setLoading(false);
          return;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signUpError) {
          const duplicate = signUpError.message.toLowerCase().includes("already registered");
          setError(duplicate ? "Ya existe una cuenta con ese correo." : signUpError.message);
          setLoading(false);
          return;
        }
        if (data.user && data.user.identities?.length === 0) {
          setError("Ya existe una cuenta con ese correo.");
          setLoading(false);
          return;
        }
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        setMessage("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setLoading(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setError("Correo o contraseña incorrectos.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("No pudimos conectar con Supabase. Revisa tu conexión e inténtalo nuevamente.");
      setLoading(false);
    }
  };

  const enterDemo = () => {
    localStorage.setItem("orbit-demo", "true");
    router.push("/demo");
  };

  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="showcase-inner">
          <Logo />
          <div className="showcase-copy">
            <span className="showcase-tag"><i /> PROYECTOS EN MOVIMIENTO</span>
            <h1>Una vista clara para que el equipo pueda <em>avanzar.</em></h1>
            <p>Planifica, conecta y anticipa el trabajo de tus proyectos desde un solo lugar.</p>
          </div>
          <div className="showcase-preview">
            <div className="preview-head"><span><i /><i /><i /></span><small>PORTAFOLIO · JULIO 2026</small></div>
            <div className="preview-metrics">
              <div><small>AVANCE GLOBAL</small><b>67%</b><span>↑ 4% este mes</span></div>
              <div><small>EN CURSO</small><b>8</b><span>3 próximos hitos</span></div>
              <div><small>REQUIEREN ATENCIÓN</small><b className="amber">2</b><span>Ver riesgos →</span></div>
            </div>
            <div className="preview-lines"><span style={{ width: "74%" }} /><span style={{ width: "48%" }} /><span style={{ width: "62%" }} /></div>
          </div>
          <div className="showcase-features">
            <span><BarChart3 /> Avance visible</span><span><Network /> Dependencias claras</span><span><CheckCircle2 /> Foco semanal</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-box">
          <div className="login-mobile-logo"><Logo /></div>
          <div className="auth-mode-switch" aria-label="Tipo de acceso">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Ingresar</button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => changeMode("signup")}>Crear cuenta</button>
          </div>
          <span className="eyebrow">{mode === "login" ? "BIENVENIDO" : "NUEVA CUENTA"}</span>
          <h2>{mode === "login" ? "Ingresa a Orbit" : "Crea tu acceso"}</h2>
          <p className="login-subtitle">{mode === "login" ? "Continúa donde dejaste tus proyectos." : "Después podrás unirte al grupo con el correo de tu líder."}</p>
          <form onSubmit={submit} className="login-form">
            {mode === "signup" && <label className="field-label">Nombre completo<input type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Tu nombre" autoComplete="name" required /></label>}
            <label className="field-label">Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.cl" autoComplete="email" required /></label>
            <label className="field-label">Contraseña<div className="password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            {mode === "signup" && <label className="field-label">Confirma tu contraseña<input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="••••••••" autoComplete="new-password" required /></label>}
            {mode === "login" && <div className="login-options"><span>Sesión segura en este dispositivo</span><button type="button" disabled title="Recuperación de contraseña disponible próximamente">¿Olvidaste tu contraseña?</button></div>}
            {error && <p className="form-error">{error}</p>}
            {message && <p className="form-success">{message}</p>}
            <button className="button primary login-submit" disabled={loading}>{loading ? (mode === "login" ? "Ingresando..." : "Creando cuenta...") : (mode === "login" ? "Ingresar" : "Crear cuenta")}<ArrowRight size={18} /></button>
          </form>
          <div className="divider"><span>o explora primero</span></div><button className="button demo-button" onClick={enterDemo}>Ver demostración completa <ArrowRight size={17} /></button>
          <p className="security-note"><LockKeyhole size={14} /> Acceso protegido</p>
          <p className="d2-love">Por y para Equipo D2 <Heart size={9} fill="currentColor" /></p>
        </div>
      </section>
    </main>
  );
}
