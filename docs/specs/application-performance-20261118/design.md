# Diseño — carga común

18/11/2026 · spec v1 · STANDARD.

## Contexto observado

Next 16.3.8, React 19.3, Supabase JS 2.117.2, pnpm. Consultadas las guías locales de Next sobre fetching y lazy loading. `loadWorkspace` autentica y encadena dashboards, listas, estadísticas, preferencias, relaciones, acceso, directorios y correo. `workspace-mail` realiza lotes de mensajes en serie; el CRM vuelve a cargar tras hidratar y usa setInterval con posibles solapamientos. Pipeline OS incluye `data` en el efecto de lectura del tablero: `refresh` cambia data y provoca una segunda petición.

## Cambios

- Separar `readWorkspace(db, profile, params)` de la envoltura autenticada para verificar la orquestación con un cliente ficticio. Los endpoints siguen usando `loadWorkspace` y `requireUser` sin cambios de permisos.
- Agrupar consultas independientes con Promise.all, manteniendo dependencias reales y errores. No consultar oportunidades en la bandeja de leads ni relaciones cuando no hay IDs. Conservar el paralelismo previo de los RPC de acceso, ejecutando directorios durante esa misma espera.
- Leer mensajes en grupos de hasta cuatro lotes concurrentes; fusionar con el mismo orden global y límite 1000. Mantener adjuntos en serie para respetar su presupuesto global sin sobreleer.
- Coordinador de lecturas del navegador para CRM y tablero Pipeline: deduplicar solicitud activa, cancelar al cambiar parámetros o desmontar, descartar respuestas obsoletas y timeout de 30 s. El CRM conserva datos visibles ante errores. Polling cada 15 s después de completar la lectura y pausa en pestaña oculta. Las acciones POST no cambian.
- Reutilizar la respuesta SSR inicial del CRM y del tablero. En Pipeline OS separar el efecto demo del efecto de red para que actualizar data no vuelva a pedir el tablero. Los refrescos posteriores a una acción leen los parámetros vigentes, y no reemplazan un expediente distinto si el usuario navega mientras esperan.

## Compatibilidad y seguridad

Sin migraciones, cambios de payload ni caché global. Los errores de lectura siguen propagándose; no se presentan ceros ante fallos SQL. Sin cambios en mailAccess, RLS o senderCapabilities. El coordinador solo hace GET. No registrar URLs con datos, cuerpos o identidades reales.

## Corrección de hidratación descubierta en preflight

La sesión productiva permite observar React418 al entrar al Resumen. Prueba con el mismo Workspace demuestra HTML diferente entre UTC y America/Bogota por dateLabel y los títulos de último envío. Añadir un contexto de fechas en el layout: UTC en servidor y primer render cliente, zona local del navegador después de montar. Solo los renderizadores de fechas del Resumen y señales consultan ese contexto; dateLabel mantiene su comportamiento por defecto para los demás consumidores. Las etiquetas relativas del Resumen usan as_of serializado para evitar que cambien durante el viaje de la página. No ocultar el error con suppressHydrationWarning.

## Verificación y reversa

Pruebas de regresión con puertos ficticios y guardia offline, typecheck, build aislado sin archivos env ni credenciales, revisión del diff. Reversa: retirar exclusivamente este delta; preservar WIP previo. Producción y medición autenticada real quedan separadas de esta implementación.

## Ajuste técnico durante implementación

Se evaluó limitar los RPC de acceso a seis simultáneos, pero eso añade hasta 17 rondas para una página de 100 expedientes. Al no existir evidencia de saturación real, se conserva su concurrencia original para evitar introducir una regresión. Un RPC de lectura por lote sería una optimización SQL posterior que requiere su propio contrato y prueba de permisos.

## Postflight: timeout SQL persistente

La primera versión70cee99 completó rolling update/health. Desaparece React418 en la entrada comprobada, pero un GET Pipeline devuelve statement timeout. No se atribuye a una tabla sin evidencia: añadir un resumen seguro por solicitud lenta (>=1500ms), máximo ocho nombres de recursos REST, número/duración de lecturas y operación/código del fallo. Sin URLs, filtros, cuerpos, identidad o credenciales. No reintentar consultas ni ocultar fallos. El resumen permite decidir la corrección siguiente sobre la operación observada en producción.

El diagnóstico9cfdcc1 muestra workspace_stats entre7118 y7440ms en cuatro solicitudes, dominante frente al resto. El código confirma que data.stats solo se renderiza en reports y overview sin financing_control. Hacer esa lectura bajo esas mismas condiciones; conservarla completa y con errores visibles en esos dos casos. La disponibilidad del dashboard moderno se comparte mediante una promesa de readiness, sin repetir el RPC. No sustituir totales globales por el conteo de una página.

También se observan1800–2243ms leyendo jobs, y500 revisiones administrativas en el payload general. Los tres arrays jobs/outbox/mail_review solo se usan en Integrations, presentado por settings/connections del CRM; Pipeline OS remite a ese módulo. Leerlos únicamente con esas vistas, conservando el requisito superadmin para jobs/outbox. Al navegar, el efecto existente pide el Workspace de la vista nueva. Las pantallas comerciales no muestran contadores falsos derivados de esas colas ni dependen de esos arrays.

El coordinador conserva explícitamente el receptor global al llamar fetch; una función nativa almacenada como propiedad no se invoca con this=WorkspaceReader. Verificado con regresión del receptor y fixture de navegador real, sin mock de fetch.
