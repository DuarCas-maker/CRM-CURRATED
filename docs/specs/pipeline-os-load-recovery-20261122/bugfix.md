# Recuperación de entrada a Pipeline OS — STANDARD

Base2d4c6fa. El usuario informa que no puede entrar a crm.finlabinc.com/pipeline-os y adjunta el error boundary. Continúa la autorización de corregir/publicar de esta conversación. Contexto confirmado en la captura, reproducción y clarificaciones previas: aplicación publicada, restaurar acceso, conservar datos/permisos y funcionalidades. No hay una decisión de negocio nueva pendiente; solo se solicitó acceso al log, y el usuario inició sesión en Coolify.

FR-001: recuperar la entrada sin consultar una proyección de correo global no filtrada. AC-001: Board y Master leen mail_conversations_visible únicamente con IDs de expedientes elegibles, lotes≤50, páginas completas y conteos exactos.

FR-002: conservar snapshots internos de Tareas, filtros/cuentas/correos únicos, historial de correo, autorizaciones de adjuntos y límites de concurrencia4/6. AC-002: regresión del timeout de una consulta sin IDs falla antes y pasa después; resultados completos y permisos no se sustituyen por ceros ni retries silenciosos.

FR-003: publicar y comprobar la recuperación real. AC-003: despliegue healthy; Board responde correctamente y varias entradas SSR completan sin error boundary. Registrar tiempos reales y límites sin prometer una latencia fija.

Reproducción22/11/2026: la entrada mostró exactamente el mismo error, sesión vigente. GET Board respondió canceling statement due to statement timeout; GET Workspace(pipeline) respondió correctamente con100 oportunidades. Log Coolify confirmó dos errores57014 en pipeline_os.mail_metadata. No se guardaron filas, cookies, contraseñas ni datos de correo.

Causa confirmada: el sondeo de pipeline-visible-mail lee la vista completa antes de filtrar por casos. Ese sondeo agota statement_timeout y rechaza el presupuesto de lecturas; Promise.all del SSR propaga el error y cae toda la ruta. El tamaño/plan/índice exacto de la BD no se diagnostica por inferencia; no hace falta alterar SQL para retirar la consulta amplia identificada.

Hipótesis descartadas: credenciales/MFA (Workspace autenticado responde); error únicamente de caché/UI (API y servidor reproducen); cambio de adjuntos o correo reciente como causa directa (sus fuentes no forman parte del query que falla). No se afirma que todas las consultas restantes ya estén rápidas: postflight pendiente.
