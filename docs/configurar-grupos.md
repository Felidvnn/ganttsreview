# Configurar grupos en Orbit

## Aplicar la segunda migración

Si la base inicial ya está instalada, abre Supabase SQL Editor, copia el contenido completo de `supabase/migrations/202607140002_groups_invitations.sql` y ejecútalo una sola vez.

Después ejecuta `supabase/migrations/202607140003_project_creation_rpc.sql`. Esta migración crea el proyecto y su propietario en una sola operación validada, evitando rechazos de RLS durante la creación.

Finalmente ejecuta `supabase/migrations/202607140004_project_sections.sql` para habilitar secciones reutilizables, secciones iniciales al crear proyectos y el desplegable de tareas e hitos.

Después ejecuta `supabase/migrations/202607140005_interactive_gantt.sql` para habilitar colores, responsables manuales o del grupo, cambios de estado y reprogramación mediante arrastre en el Gantt.

Por último ejecuta `supabase/migrations/202607140006_task_management.sql` para habilitar edición y eliminación completa de tareas, avance porcentual, apuntes privados, dependencias con validación de ciclos y actividad del proyecto.

Luego ejecuta `supabase/migrations/202607140007_subtasks_followups.sql` para habilitar subtareas y sub-subtareas, cálculo opcional del avance desde tareas hijas y el seguimiento operativo de compromisos, recordatorios y bloqueos.

Finalmente ejecuta `supabase/migrations/202607150008_project_statuses_privacy.sql` para habilitar estados configurables por proyecto y asegurar que los proyectos privados no sean visibles para el líder salvo que hayan sido compartidos explícitamente.

Después ejecuta `supabase/migrations/202607150009_task_priority_external_assignees.sql` para guardar prioridades y mantener un catálogo reutilizable de responsables externos por proyecto.

Finalmente ejecuta `supabase/migrations/202607170010_drag_hierarchy.sql` para poder reorganizar tareas, subtareas y sub-subtareas mediante arrastre, conservando la profundidad máxima y evitando ciclos.

Después ejecuta `supabase/migrations/202607170011_admin_invitation_readiness.sql` para que administradores e invitados puedan identificarse correctamente durante solicitudes pendientes sin abrir la visibilidad de perfiles ajenos al grupo.

Finalmente ejecuta `supabase/migrations/202607170012_project_visibility_group_exit.sql` para habilitar proyectos privados, compartidos con el líder o colaborativos por invitación, además de la salida segura y transferencia de liderazgo entre grupos.

Luego ejecuta `supabase/migrations/202607170013_safe_group_project_removal.sql`. Esta migración permite cerrar un grupo de una sola persona sin eliminar proyectos, conserva el historial de membresías y exige que el propietario escriba el nombre del proyecto antes de borrarlo. Un colaborador nunca borra el proyecto: solo puede retirar su propio acceso.

Ejecuta después `supabase/migrations/202607170014_group_invitation_switch.sql` para corregir la respuesta de invitaciones, mostrar invitaciones de otros grupos aunque ya pertenezcas a uno y permitir el cambio directo conservando toda la información. Orbit mantiene un solo grupo activo por persona; si el usuario lidera un grupo con integrantes, debe transferir el liderazgo antes del cambio.

Finalmente ejecuta `supabase/migrations/202607170015_leader_team_visibility.sql` para que el inicio del líder muestre en **Equipo** todos los proyectos no privados asociados a su grupo. Los proyectos privados nunca aparecen para el líder y el acceso de equipo es de solo lectura, salvo que el líder también haya sido invitado como editor.

La migración:

- conserva el workspace y los proyectos existentes;
- convierte al líder actual en administrador;
- agrega el correo a los perfiles;
- corrige la visibilidad de proyectos;
- crea invitaciones y solicitudes de unión;
- permite asignar administradores;
- permite compartir proyectos por correo.

## Reglas de acceso

- Líder: ve sus proyectos y aquellos marcados como **Con mi líder** por integrantes del grupo.
- Ingeniero: ve sus proyectos y los proyectos colaborativos a los que fue invitado.
- Administrador: puede gestionar integrantes, pero no obtiene visibilidad adicional.
- Creador/editor: puede editar el proyecto.
- Lector: solo puede consultarlo.
- Salir o ser retirado de un grupo no elimina proyectos, tareas ni colaboraciones existentes.
- Solo el propietario real puede eliminar un proyecto y debe confirmar escribiendo su nombre completo.

## Incorporar personas

Cada persona debe crear primero su cuenta desde **Crear cuenta** en el acceso de Orbit. Si la confirmación por correo está habilitada en Supabase, debe abrir el enlace recibido antes de ingresar.

En **Authentication → URL Configuration**, registra `http://localhost:3000/auth/callback` como Redirect URL. Cuando publiques en Vercel, registra también `https://tu-dominio.vercel.app/auth/callback`.

Después puede ocurrir uno de estos flujos:

1. Un líder o administrador abre **Grupo**, escribe el correo y envía una invitación. La persona entra a Orbit, abre **Grupo** y la acepta.
2. Un ingeniero sin grupo abre **Grupo**, escribe el correo del líder y envía una solicitud. Un líder o administrador la acepta.

Escribir el correo no entrega acceso inmediatamente: siempre debe existir aceptación.

## Compartir un proyecto

La persona debe pertenecer al mismo grupo. En el detalle del proyecto, usa **Compartir**, escribe su correo y selecciona `Puede editar` o `Solo lectura`.

## Verificación rápida

1. Reinicia el servidor después de cualquier cambio en `.env.local`.
2. Entra como líder y confirma que **Grupo** muestra D2.
3. Crea un segundo usuario desde **Crear cuenta** en Orbit.
4. Invítalo desde Orbit.
5. Entra como el segundo usuario y acepta.
6. Crea un proyecto con el ingeniero: el líder debe verlo, pero no editarlo hasta que se lo comparta como editor.
