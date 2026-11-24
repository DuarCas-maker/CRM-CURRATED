# BUG-001 — Tareas abiertas no completa la carga

SDD STANDARD; publicación bajo controles STRICT. Reportado el 23/11/2026 en producción. Base 4d59ed4. Severidad alta; lectura sin escrituras de negocio.

## Alcance confirmado

Recuperar la tabla y filtros por correo con las reglas ya confirmadas en este chat. No cambian atribución, cifras, permisos, campañas ni envíos. No hay ambigüedad funcional nueva; las preguntas previas sobre pendientes/deduplicación siguen cerradas. Diagnóstico de conexión y consultas autorizado; publicación de esta misma tabla autorizada expresamente antes en el chat.

FR-001 / AC-001: carga completa dentro del límite actual de 30 segundos, sin devolver ceros o catálogos parciales para esconder errores.
FR-002 / AC-002: datos y filtros por cuenta conservan equivalencia y autorización.
FR-003 / AC-003: error termina el estado de carga y permite reintentar.
FR-004 / AC-004: evidencia operativa identifica tiempos/operación/código sin guardar identidades, URLs, cuerpos ni credenciales.

## Reproducción y diagnóstico

Sesión existente con MFA. Entrada Pipeline OS correcta; 1.153 expedientes. Seleccionar Tareas abiertas: después de 32.889ms aparece el error genérico y permanece «Actualizando etapas…». Consulta autenticada del resumen con filtro ficticio que excluye los detalles devuelve JSON completo (4.040 leads), lo cual descarta desconexión permanente y sesión caducada. Una navegación tarda más de 20s. No se confunde éxito eventual con cumplir el límite del cliente.

H1 confirmada: pipeline_tasks_read registra 57.580ms; lead_workspace nueve llamadas, 57.254ms acumulados, máximo7.734ms. El lector pide COUNT exacto en cada página de500; el COUNT de la vista con RLS y proyecciones laterales vuelve a recorrer el catálogo completo. El resultado HTTP llega después de que WorkspaceReader haya abortado a30s.
H2 descartada en esa reproducción: la lectura del servidor terminó sin failure; no es un fallo SQL permanente. El test reproduce57014 cuando se pide el COUNT costoso, para impedir volver a introducirlo.
H3: desconexión o sesión inválida; no explica el JSON autenticado completo, descartada como causa permanente.

Lecturas recientes de Workspace: 11–14s; tres páginas de mail consumen 9–11s. No prueban por sí solas el cuello de Tareas. No se modifica la consulta antes de medirla.

Regresión roja observada: tasks-overview-volume.test.ts, 4.040 leads ficticios, mismo error de timeout al solicitar COUNT. Antes de corregir:0/1. El ensayo preliminar de catálogos de etapas vacíos detectó exceso de llamadas, pero no era el cuello principal y no se implementa ese cambio.

Prevención: regresión del caso confirmado y señales seguras. Sin reparación de datos prevista. La medición es operacional permanente, no una simulación de recuperación.
