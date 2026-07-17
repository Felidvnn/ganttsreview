# Orbit

Aplicación interna para gestionar proyectos, cartas Gantt, dependencias transversales y compromisos semanales. Está construida con Next.js y preparada para usar Supabase como autenticación, base de datos, auditoría y sincronización en tiempo real.

## Ejecutar localmente

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`. Si no existen variables de Supabase, el acceso ofrece un modo demostración local con datos ficticios.

## Conectar Supabase

1. Crea un proyecto en Supabase.
2. Copia `.env.example` como `.env.local`.
3. Completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` desde la configuración API del proyecto.
4. Ejecuta las migraciones, en orden, desde Supabase SQL Editor o mediante Supabase CLI:
   - [`supabase/migrations/202607140001_initial_schema.sql`](supabase/migrations/202607140001_initial_schema.sql)
   - [`supabase/migrations/202607140002_groups_invitations.sql`](supabase/migrations/202607140002_groups_invitations.sql)
   - [`supabase/migrations/202607140003_project_creation_rpc.sql`](supabase/migrations/202607140003_project_creation_rpc.sql)
   - [`supabase/migrations/202607140004_project_sections.sql`](supabase/migrations/202607140004_project_sections.sql)
   - [`supabase/migrations/202607140005_interactive_gantt.sql`](supabase/migrations/202607140005_interactive_gantt.sql)
   - [`supabase/migrations/202607140006_task_management.sql`](supabase/migrations/202607140006_task_management.sql)
   - [`supabase/migrations/202607140007_subtasks_followups.sql`](supabase/migrations/202607140007_subtasks_followups.sql)
   - [`supabase/migrations/202607150008_project_statuses_privacy.sql`](supabase/migrations/202607150008_project_statuses_privacy.sql)
   - [`supabase/migrations/202607150009_task_priority_external_assignees.sql`](supabase/migrations/202607150009_task_priority_external_assignees.sql)
   - [`supabase/migrations/202607170010_drag_hierarchy.sql`](supabase/migrations/202607170010_drag_hierarchy.sql)
   - [`supabase/migrations/202607170011_admin_invitation_readiness.sql`](supabase/migrations/202607170011_admin_invitation_readiness.sql)
   - [`supabase/migrations/202607170012_project_visibility_group_exit.sql`](supabase/migrations/202607170012_project_visibility_group_exit.sql)
   - [`supabase/migrations/202607170013_safe_group_project_removal.sql`](supabase/migrations/202607170013_safe_group_project_removal.sql)
5. En Supabase, deja habilitado el proveedor **Email** y agrega `http://localhost:3000/auth/callback` a las Redirect URLs de Authentication. Para Vercel, agrega también `https://tu-dominio.vercel.app/auth/callback`.
6. Cada integrante puede crear su cuenta desde la pantalla de acceso. El trigger `handle_new_user` crea automáticamente su perfil y luego puede solicitar unirse al grupo desde **Grupo**.

Cuando las variables están configuradas, las rutas de trabajo exigen una sesión válida y desaparece el acceso de demostración.

## Seguridad y permisos

El esquema separa dos conceptos:

- Rol de organización: `leader` o `engineer`.
- Permiso por proyecto: `owner`, `editor` o `viewer`.

`is_admin` es una capacidad del grupo, no un tercer rol: un ingeniero administrador puede invitar, aceptar o eliminar integrantes, pero conserva la visibilidad normal de ingeniero. El líder ve sus proyectos, aquellos donde fue invitado y los que los ingenieros marcan **Con mi líder**; los proyectos privados permanecen privados.

Las políticas RLS distinguen proyectos privados, compartidos con el líder y colaborativos por invitación. Salir de un grupo conserva los proyectos propios y revoca la visibilidad del líder anterior. La seguridad no depende de ocultar controles en la interfaz. Las modificaciones de tareas quedan registradas en `audit_logs` mediante un trigger de base de datos.

## Vistas incluidas

- Acceso y creación de cuentas con Supabase Auth y confirmación por correo.
- Inicio personal con indicadores, atención del día y actividad reciente.
- Catálogo de proyectos con privacidad y estados de salud.
- Gantt con secciones, avance, responsables y bloqueos.
- Vista móvil de tareas adaptada a pantallas pequeñas.
- Checklist semanal interactivo.
- Portafolio consolidado para líderes.
- Mapa de dependencias entre distintos proyectos.
- Capacidad del equipo y preferencias personales.
- Grupos con invitaciones y solicitudes por correo.
- Administradores de grupo y eliminación segura de integrantes.
- Proyectos compartidos con permisos de edición o lectura.

## Verificación

```bash
npm run typecheck
npm run build
```

## Datos reales y modo demostración

Sin variables de entorno, la interfaz usa los datos de `src/lib/demo-data.ts`. Al configurar Supabase, el inicio, el consolidado, el catálogo y el detalle Gantt consultan automáticamente `projects`, `project_members` y `tasks`; crear proyectos, tareas o hitos escribe en la base de datos, y los cambios de avance se guardan con actualización optimista. La actividad reciente y el diagrama inicial de dependencias conservan ejemplos visuales hasta que existan registros de auditoría y relaciones suficientes.
