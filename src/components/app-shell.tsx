"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness, CalendarCheck2, CalendarDays, ChartNoAxesCombined,
  Bell, CircleHelp, Heart, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Users, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { people } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { Logo } from "./logo";
import { QuickCreate } from "./quick-create";

const nav = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/projects", label: "Proyectos", icon: BriefcaseBusiness },
  { href: "/calendar", label: "Calendario", icon: CalendarDays },
  { href: "/portfolio", label: "Portafolio", icon: ChartNoAxesCombined, leader: true },
  { href: "/week", label: "Seguimiento", icon: CalendarCheck2 },
  { href: "/team", label: "Grupo", icon: Users },
];

const titles: Record<string, string> = {
  "/dashboard": "Inicio", "/projects": "Proyectos", "/portfolio": "Portafolio", "/calendar": "Calendario",
  "/week": "Seguimiento", "/team": "Grupo", "/settings": "Configuración",
};

type ShellContext = {
  id: string; name: string; initials: string; role: "leader" | "engineer";
  workspaceId: string | null; hasGroup: boolean; isAdmin: boolean; groupName: string; weekPendingCount: number; groupInvitationCount: number;
} | null;

export function AppShell({ children, shell }: { children: React.ReactNode; shell: ShellContext }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [weekPendingCount, setWeekPendingCount] = useState(shell?.weekPendingCount ?? 0);
  const currentTitle = pathname.startsWith("/projects/") ? "Detalle del proyecto" : (titles[pathname] ?? "Orbit");
  const profile = shell ? {
    id: shell.id, name: shell.name, initials: shell.initials,
    role: shell.role === "leader" ? "Líder" as const : "Ingeniero" as const,
    color: shell.role === "leader" ? "#245f55" : "#376f9e",
  } : people[0];
  const visibleNav = nav.filter((item) => !item.leader || !shell || shell.role === "leader");

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("orbit-sidebar-collapsed") === "true");
  }, []);
  useEffect(() => setWeekPendingCount(shell?.weekPendingCount ?? 0), [shell?.weekPendingCount]);
  useEffect(() => {
    const updatePendingCount = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail ?? 0;
      setWeekPendingCount((current) => Math.max(0, current + delta));
    };
    window.addEventListener("orbit:week-pending-delta", updatePendingCount);
    return () => window.removeEventListener("orbit:week-pending-delta", updatePendingCount);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("orbit-sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <div className={`app-frame ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Logo />
          <button className="icon-button sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expandir panel lateral" : "Guardar panel lateral"} title={sidebarCollapsed ? "Expandir panel" : "Guardar panel"}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar navegación"><X size={19} /></button>
        </div>
        <button className="create-button" onClick={() => setCreateOpen(true)}><Plus size={18} /> Crear</button>
        <nav className="main-nav" aria-label="Navegación principal">
          <span className="nav-kicker">ESPACIO DE TRABAJO</span>
          {visibleNav.map(({ href, label, icon: Icon, leader }) => {
            const active = pathname === href || (href === "/projects" && pathname.startsWith("/projects/"));
            return (
              <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
                <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
                {leader && <span className="leader-dot" title="Solo líderes" />}
                {href === "/week" && weekPendingCount > 0 && <span className="nav-badge">{weekPendingCount}</span>}
                {href === "/team" && (shell?.groupInvitationCount ?? 0) > 0 && <span className="nav-badge">{shell!.groupInvitationCount}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/settings" className={`nav-item ${pathname === "/settings" ? "active" : ""}`}><Settings size={19} /><span>Configuración</span></Link>
          <button className="nav-item nav-button" disabled title="Ayuda disponible próximamente"><CircleHelp size={19} /><span>Ayuda</span></button>
          <button className="profile-card" onClick={async () => { await createClient()?.auth.signOut(); router.push("/login"); router.refresh(); }} title="Cerrar sesión">
            <Avatar person={profile} />
            <span className="profile-copy"><b>{profile.name}</b><small>{shell ? `${shell.role === "leader" ? "Líder" : "Ingeniero"}${shell.isAdmin && shell.role !== "leader" ? " · Admin" : ""} · ${shell.groupName}` : "Modo demostración"}</small></span>
            <LogOut size={15} />
          </button>
          <span className="d2-sidebar-signature">Por y para Equipo D2 <Heart size={8} fill="currentColor" /></span>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación"><Menu size={21} /></button>
            <div><span className="mobile-brand">ORBIT</span><h1>{currentTitle}</h1></div>
          </div>
          <div className="topbar-actions">
            <button className="search-button" disabled title="Búsqueda global disponible próximamente">
              <Search size={18} />
              <input aria-label="Buscar" placeholder="Buscar proyectos, tareas..." disabled />
              <kbd>⌘ K</kbd>
            </button>
            <Link href="/team" className="icon-button notification-button" aria-label={(shell?.groupInvitationCount ?? 0) > 0 ? `${shell!.groupInvitationCount} invitaciones de grupo pendientes` : "Sin invitaciones de grupo pendientes"} title={(shell?.groupInvitationCount ?? 0) > 0 ? "Ver invitaciones de grupo" : "Sin invitaciones pendientes"}><Bell size={18} />{(shell?.groupInvitationCount ?? 0) > 0 && <i />}</Link>
            <Link href="/settings" className="top-avatar" aria-label="Abrir perfil"><Avatar person={profile} size="sm" /></Link>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>

      <nav className="mobile-tabs" aria-label="Navegación móvil">
        {visibleNav.filter((item) => ["/dashboard", "/projects", "/calendar", "/week"].includes(item.href)).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={pathname === href || (href === "/projects" && pathname.startsWith("/projects/")) ? "active" : ""}>
            <Icon size={21} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      <button className="mobile-fab" onClick={() => setCreateOpen(true)} aria-label="Crear"><Plus size={23} /></button>
      <QuickCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
