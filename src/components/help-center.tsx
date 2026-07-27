"use client";

import Link from "next/link";
import {
  ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronDown,
  CircleHelp, Columns3, FolderKanban, GanttChart, KeyRound,
  LayoutDashboard, ListChecks, MessageSquareText, Search, Settings2, ShieldCheck,
  Sparkles, Users, X,
} from "lucide-react";
import { useMemo, useState } from "react";

type HelpModule = {
  id: string;
  menu: string;
  title: string;
  description: string;
  icon: typeof CircleHelp;
  color: string;
  href?: string;
  functions: Array<{ title: string; body: string }>;
  progressGuide?: boolean;
};

const modules: HelpModule[] = [
  {
    id: "inicio",
    menu: "Inicio",
    title: "Tu panorama de trabajo",
    description: "Una lectura rápida de proyectos, pendientes y próximos compromisos.",
    icon: LayoutDashboard,
    color: "#2f7669",
    href: "/dashboard",
    functions: [
      { title: "Vista personal", body: "Reúne tus proyectos propios y colaborativos, sin mezclar el seguimiento general del equipo." },
      { title: "Vista de equipo", body: "Para líderes, agrupa información por integrante y muestra el trabajo compartido con la jefatura. Los proyectos privados nunca aparecen." },
      { title: "Salud del proyecto", body: "Resume vencimientos, bloqueos y diferencia respecto del plan. Es una orientación para revisar, no una evaluación de desempeño." },
    ],
  },
  {
    id: "proyectos",
    menu: "Proyectos",
    title: "Organización completa de cada proyecto",
    description: "Acceso, vistas, notas, pendientes, atrasos e informes en un mismo lugar.",
    icon: FolderKanban,
    color: "#3d7896",
    href: "/projects",
    functions: [
      { title: "Acceso y colaboración", body: "Un proyecto puede ser privado, colaborativo por invitación y, de manera independiente, mostrarse al líder." },
      { title: "Vistas del proyecto", body: "Alterna entre Gantt, lista, tablero, hitos, pendientes, notas, atrasos, informes y actividad sin duplicar información." },
      { title: "Filtros compartidos", body: "Filtra por plazo y estado. Lista, tablero, hitos, Gantt y exportaciones utilizan la misma selección visible." },
      { title: "Eliminación segura", body: "Solo el propietario real puede eliminar un proyecto y debe escribir su nombre completo para confirmar." },
    ],
  },
  {
    id: "gantt",
    menu: "Carta Gantt",
    title: "Planificación y avance",
    description: "Fechas, jerarquía, responsables y progreso de cada actividad.",
    icon: GanttChart,
    color: "#80629b",
    href: "/projects",
    progressGuide: true,
    functions: [
      { title: "Edición directa", body: "Puedes cambiar estado, tipo, prioridad, responsables, avance y fechas desde sus columnas, sin abrir la tarea." },
      { title: "Tareas anidadas", body: "Arrastra una tarea para cambiar su nivel. Las ramas pueden ocultarse y los movimientos que superan el límite se rechazan con una alerta." },
      { title: "Duración", body: "La columna Días calcula días calendario incluyendo inicio y fin. Una actividad del mismo día cuenta como un día." },
      { title: "Atrasos visibles", body: "Una tarea pendiente vencida muestra una etiqueta con los días de atraso, una fila diferenciada y puede aislarse con el filtro Atrasadas." },
      { title: "Fechas provisionales", body: "Puedes guardar inicio y fin invertidos mientras corriges la planificación. La celda queda marcada hasta resolver la inconsistencia." },
    ],
  },
  {
    id: "calendario",
    menu: "Calendario",
    title: "Todo lo que ocurre en el tiempo",
    description: "Cuatro semanas navegables con tareas, hitos, compromisos y pendientes.",
    icon: CalendarDays,
    color: "#a66d35",
    href: "/calendar",
    functions: [
      { title: "Vista transversal", body: "Reúne información de todos los proyectos visibles y distingue cada origen mediante nombre y color." },
      { title: "Filtros", body: "Acota por rango, proyecto, responsable, tipo de pendiente y ámbito personal o de equipo." },
      { title: "Creación desde un día", body: "Selecciona una fecha para crear una tarea, hito o pendiente en el proyecto elegido." },
      { title: "Exportación", body: "Genera una salida del calendario con el periodo y filtros que estés utilizando." },
    ],
  },
  {
    id: "seguimiento",
    menu: "Seguimiento",
    title: "Pendientes y compromisos semanales",
    description: "Un lugar operativo para recordar lo que no necesariamente pertenece a la Gantt.",
    icon: ListChecks,
    color: "#477c6d",
    href: "/week",
    functions: [
      { title: "Bandejas por vencimiento", body: "Separa atrasadas, vencen esta semana, personales y vencen la semana siguiente." },
      { title: "Contexto de subtareas", body: "Las subtareas muestran su tarea principal, proyecto, responsables y fecha para comprender el pendiente." },
      { title: "Compromisos y bloqueos", body: "Un pendiente puede relacionarse con una tarea y marcarse como bloqueo sin incorporarlo obligatoriamente a la Gantt." },
      { title: "Recuento semanal", body: "El resumen considera también lo que vence durante la semana para ayudarte a saber si vas al día." },
    ],
  },
  {
    id: "equipo",
    menu: "Grupo",
    title: "Personas, invitaciones y liderazgo",
    description: "Administración del grupo sin mezclar permisos de proyecto.",
    icon: Users,
    color: "#527493",
    href: "/team",
    functions: [
      { title: "Integrantes reales", body: "La vista de jefatura considera como ingenieros solo a quienes pertenecen al grupo, no a cualquier responsable guardado." },
      { title: "Invitaciones visibles", body: "Una invitación pendiente puede verse aunque la persona pertenezca actualmente a otro grupo." },
      { title: "Cambio de grupo", body: "El cambio conserva proyectos, colaboraciones e historial. Si el líder no está solo, debe transferir el liderazgo." },
      { title: "Lectura versus edición", body: "Mostrar al líder permite seguimiento. Para editar, el líder necesita además una invitación como colaborador editor." },
    ],
  },
  {
    id: "configuracion",
    menu: "Configuración",
    title: "Reglas y preferencias",
    description: "Personaliza el proyecto sin perder consistencia ni trazabilidad.",
    icon: Settings2,
    color: "#786b91",
    href: "/settings",
    functions: [
      { title: "Estados", body: "Renombra, colorea, ordena y activa los estados disponibles por proyecto. Deben permanecer al menos dos activos." },
      { title: "Tipos de tarea", body: "Crea categorías como proceso, reunión o entregable y asígnales un color propio." },
      { title: "Columnas", body: "Oculta columnas y cambia su ancho arrastrando el borde, como en una hoja de cálculo. La preferencia queda guardada en el dispositivo." },
      { title: "Importación", body: "Descarga la plantilla Excel, completa tareas y jerarquías y crea un proyecto de forma más rápida." },
    ],
  },
  {
    id: "notas-informes",
    menu: "Notas e informes",
    title: "Contexto compartido y salidas",
    description: "Decisiones, trazabilidad y documentos listos para compartir.",
    icon: MessageSquareText,
    color: "#9b6938",
    functions: [
      { title: "Notas del proyecto", body: "Registra reunión, avance o decisión con autor y fecha. Usa @ para citar tareas." },
      { title: "Creación contextual", body: "Desde una nota puedes crear un pendiente o atraso y dejar registrada su procedencia." },
      { title: "Apuntes privados", body: "Los apuntes personales de una tarea solo son visibles para ti y nunca aparecen en exportaciones." },
      { title: "Exportaciones filtradas", body: "Excel, PDF, HTML e imagen usan los filtros activos. Excel incluye jerarquía, fechas, duración, responsables y avance." },
    ],
  },
];

const faqs = [
  {
    question: "¿Cómo se calcula el avance informado del proyecto?",
    answer: "Se promedian las tareas principales. Cada una puede tener un porcentaje informado manualmente o calcularlo desde el promedio de sus subtareas directas. Las subtareas no vuelven a sumarse, evitando contar dos veces el mismo trabajo.",
  },
  {
    question: "¿Qué significa “Esperado al día de hoy”?",
    answer: "Es una referencia calculada con las fechas planificadas y la fecha indicada en pantalla. Antes del inicio espera 0%, después del término espera 100% y entre ambas fechas avanza proporcionalmente.",
  },
  {
    question: "¿Por qué las tareas completadas se muestran aparte?",
    answer: "Porque una tarea al 90% contiene avance real aunque todavía no esté cerrada. Por eso Orbit muestra tanto el avance informado como la cantidad completada, en lugar de reemplazar uno por el otro.",
  },
  {
    question: "¿Cuándo se considera atrasada una tarea?",
    answer: "Cuando sigue pendiente y su fecha de fin ya pasó. La aplicación muestra cuántos días lleva vencida. Una tarea terminada dentro del plazo no se considera atraso.",
  },
  {
    question: "¿Qué provoca el estado En riesgo?",
    answer: "Una tarea bloqueada o una diferencia de 15 puntos o más entre lo esperado y lo informado. Si ya existe un vencimiento pendiente, el estado pasa a Atrasado. Prioridad Alta, por sí sola, no modifica la salud.",
  },
  {
    question: "¿Fecha real se completa automáticamente?",
    answer: "No. Es una fecha opcional ingresada conscientemente para registrar el cierre efectivo. Al escribirla, la tarea queda completada; marcar una tarea como lista no inventa una fecha real.",
  },
  {
    question: "¿Qué sucede si salgo de un grupo o quito mi acceso?",
    answer: "No se elimina el proyecto ni sus tareas. Se termina el acceso o membresía correspondiente y se conserva la información original.",
  },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const search = normalize(query.trim());
  const filteredModules = useMemo(() => !search ? modules : modules.filter((module) =>
    normalize([module.menu, module.title, module.description, ...module.functions.flatMap((item) => [item.title, item.body])].join(" ")).includes(search)
  ), [search]);
  const filteredFaqs = useMemo(() => !search ? faqs : faqs.filter((faq) =>
    normalize(`${faq.question} ${faq.answer}`).includes(search)
  ), [search]);

  return <div className="help-page help-page-modular">
    <section className="help-hero help-hero-compact">
      <div className="help-hero-copy">
        <span className="eyebrow"><Sparkles size={13} /> CENTRO DE AYUDA</span>
        <h2>¿Qué necesitas entender?</h2>
        <p>Recorre Orbit siguiendo el mismo orden del menú. Cada sección explica para qué sirve, qué puedes hacer y las reglas que conviene conocer.</p>
        <label className="help-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar una función o pregunta…" />{query && <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}</label>
      </div>
      <div className="help-hero-mark"><CircleHelp size={34} /><span>GUÍA DE ORBIT</span><b>{modules.length}</b><small>secciones explicadas</small></div>
    </section>

    {!search && <section className="help-module-nav panel">
      <header><div><span className="eyebrow">SECCIONES DEL MENÚ</span><h3>Empieza por el lugar que estás usando</h3></div><Columns3 size={21} /></header>
      <div>{modules.map((module) => {
        const Icon = module.icon;
        return <a href={`#help-${module.id}`} key={module.id}><span style={{ color: module.color, background: `color-mix(in srgb, ${module.color} 10%, white)` }}><Icon size={17} /></span><b>{module.menu}</b><ArrowRight size={13} /></a>;
      })}</div>
    </section>}

    <section className="help-section-head"><div><span className="eyebrow">{search ? "RESULTADOS" : "FUNCIONES POR SECCIÓN"}</span><h3>{search ? `${filteredModules.length + filteredFaqs.length} coincidencias para “${query}”` : "Cómo funciona cada parte de Orbit"}</h3></div>{search && <button className="button secondary small" onClick={() => setQuery("")}><X size={14} /> Ver toda la ayuda</button>}</section>

    {filteredModules.length > 0 && <section className="help-module-list">
      {filteredModules.map((module, index) => {
        const Icon = module.icon;
        return <details id={`help-${module.id}`} className="help-module" key={module.id} open={Boolean(search) || index === 0}>
          <summary>
            <span className="help-module-icon" style={{ color: module.color, background: `color-mix(in srgb, ${module.color} 10%, white)` }}><Icon size={20} /></span>
            <span><small>{module.menu}</small><b>{module.title}</b><em>{module.description}</em></span>
            <ChevronDown size={18} />
          </summary>
          <div className="help-module-body">
            <div className="help-function-grid">{module.functions.map((item) => <article key={item.title}><span><CheckCircle2 size={14} /></span><div><b>{item.title}</b><p>{item.body}</p></div></article>)}</div>
            {module.progressGuide && <div className="help-progress-calm">
              <header><div><span>LECTURA DEL AVANCE</span><h4>Cuatro datos distintos, sin dramatizar el proyecto</h4></div><BarChart3 size={21} /></header>
              <div>
                <article><small>AVANCE INFORMADO</small><b>48%</b><p>Trabajo declarado en las tareas principales.</p></article>
                <article><small>ESPERADO AL 27 JUL 2026</small><b>53%</b><p>Referencia proporcional según el calendario.</p></article>
                <article><small>TAREAS COMPLETADAS</small><b>8 / 12</b><p>Cierres efectivos, mostrados por separado.</p></article>
                <article><small>RESPECTO DEL PLAN</small><b>5 pts bajo</b><p>Una diferencia para revisar, no una alarma automática.</p></article>
              </div>
              <p><CircleHelp size={14} /> Todas las tareas principales pesan lo mismo. Si una actividad representa mucho trabajo, puedes desglosarla y activar el cálculo desde subtareas.</p>
            </div>}
            {module.href && <Link className="help-module-link" href={module.href}>Abrir {module.menu.toLowerCase()} <ArrowRight size={14} /></Link>}
          </div>
        </details>;
      })}
    </section>}

    {filteredFaqs.length > 0 && <section className="help-faq panel">
      <header><div><span className="eyebrow">PREGUNTAS FRECUENTES</span><h3>Reglas que ayudan a interpretar la información</h3></div><CircleHelp size={22} /></header>
      <div>{filteredFaqs.map((faq, index) => <details key={faq.question} open={Boolean(search) || index === 0}><summary><span>{faq.question}</span><ChevronDown size={17} /></summary><p>{faq.answer}</p></details>)}</div>
    </section>}

    {!filteredModules.length && !filteredFaqs.length && <section className="help-empty"><Search size={24} /><h3>No encontramos ese concepto</h3><p>Prueba con “filtros”, “avance esperado”, “subtarea”, “líder” o “exportar”.</p><button className="button secondary" onClick={() => setQuery("")}>Limpiar búsqueda</button></section>}

    {!search && <section className="help-safety panel"><span><ShieldCheck size={22} /></span><div><h3>La seguridad acompaña todas las secciones</h3><p>Salir de un grupo, ocultar un proyecto o quitar tu acceso no elimina el trabajo original. Solo el propietario puede borrar un proyecto y debe confirmarlo por escrito.</p></div><Link href="/settings"><KeyRound size={15} /> Revisar configuración</Link></section>}
  </div>;
}
