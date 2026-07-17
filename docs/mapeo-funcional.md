# Mapeo funcional de Orbit Gantt

## Funciones operativas

- Autenticación con Supabase y acceso protegido.
- Grupos con líder, ingenieros y administradores.
- Proyectos privados, compartidos o visibles para el grupo.
- Colaboradores con permisos de lectura o edición y registro de cambios.
- Creación de proyectos con secciones iniciales.
- Creación, edición y eliminación de tareas e hitos.
- Fechas modificables desde el formulario o arrastrando la cápsula.
- Avance porcentual editable en el Gantt y en el detalle.
- Estados, responsable del grupo o responsable manual/ficticio.
- Colores manuales o automáticos por responsable, sección o estado.
- Descripción compartida y apuntes privados por usuario.
- Dependencias entre tareas del mismo proyecto o proyectos transversales.
- Validación para impedir dependencias cíclicas.
- Vistas Gantt, Lista, Tablero, Hitos, Informes y Actividad.
- Exportación CSV, HTML, PNG y versión imprimible para PDF.
- Subtareas y sub-subtareas con avance agregado opcional.
- Seguimiento operativo separado de la Gantt para compromisos y bloqueos.
- Resumen semanal, consolidado de portafolio y trazabilidad de tareas.

## Pendientes recomendados

### Prioridad alta

- Comentarios colaborativos con menciones y notificaciones; la tabla existe, pero falta la experiencia de usuario.
- Carga de archivos reales en Supabase Storage, permisos y vista previa. La vista Informes reemplaza por ahora al antiguo placeholder de Archivos.
- Edición masiva, duplicación de tareas e importación desde CSV o Excel.
- Deshacer cambios y restaurar versiones desde el historial de auditoría.
- Búsqueda global de proyectos, tareas, responsables y notas compartidas.
- Cálculo de ruta crítica, holgura y alertas al mover una tarea que bloquea otras.

### Prioridad media

- Notificaciones dentro de la aplicación y por correo para atrasos, asignaciones y bloqueos.
- Comparación visual contra línea base y reprogramación formal del proyecto.
- Vista de carga/capacidad por integrante y detección de sobreasignación.
- Plantillas de proyecto, tareas recurrentes y clonación de Gantts.
- Calendarios laborales, feriados, jornadas y exclusión real de fines de semana.
- Filtros guardados y preferencias persistentes de color/vista por usuario.

### Antes de producción

- Pruebas automatizadas de permisos RLS para líder, ingeniero, administrador, editor y lector.
- Pruebas de concurrencia para edición simultánea y resolución de conflictos.
- Política de respaldo, recuperación, retención de auditoría y límites de archivos.
- Accesibilidad de teclado, contraste y pruebas en dispositivos móviles reales.
- Tutorial integrado y ayuda contextual cuando el flujo funcional se estabilice.
