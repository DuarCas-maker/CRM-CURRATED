# Estado de aceptación — 8 de octubre de 2026

Código implementado y probado localmente. **No declarar el MVP listo para piloto hasta completar la columna de validación externa y cotejar el formulario original.** El usuario confirmó las migraciones 001–007, acceso del superadmin, importación con trabajador, despliegue de web/trabajador en Coolify y configuración de Bouncer. Se comprobó HTTPS y HTTP 200 en `https://crm.finlabinc.com/api/health`. Quedan pendientes aplicar la migración 008, desplegar el flujo separado de leads/oportunidades y las pruebas externas completas de permisos, Gmail, Bouncer y formulario. Las credenciales locales no se incluyen en el repositorio.

| # | Criterio del PRD | Evidencia local | Validación pendiente en el piloto |
|---|---|---|---|
| 1 | Encabezados distintos y mapeo | Detección, corrección y selección de hoja; pruebas CSV/XLSX | Bases representativas del equipo |
| 2 | 50.000 filas en segundo plano | Parser y 50.000 filas persistidas por RPC, bloques de 250, replay sin duplicación; 42,3 s en PGlite | Subida a Storage, worker reiniciado durante carga, memoria, latencia UI y concurrencia en servidor real |
| 3 | Reimportar conserva historial | Prueba SQL de contacto existente sin sobrescritura y contadores idempotentes | Lotes reales con formatos y duplicados representativos |
| 4 | Inválidos, inciertos y excluidos no reciben campaña | Filtro al inscribir y al reclamar envío; exclusión global persistente | Muestra Bouncer con los cuatro resultados y reimportación |
| 5 | Remitente y seller independientes | Modelo, formulario y comando separados; permisos de cuenta independientes | Dos sellers con una cuenta compartida |
| 6 | Respuesta o baja detiene secuencia | Cancelación SQL y deduplicación probadas; enlace de baja y clasificación de rebotes implementados | Respuesta real, rebote real en hilo nuevo y baja entre dos pasos |
| 7 | Desconexión y reintentos fiables | Locks, reservas, fencing, checkpoints y conciliación por Message-ID; uncertain nunca se reclama como queued | Revocar OAuth, cortar conexión durante envío, repetir Pub/Sub, expirar historyId y watch |
| 8 | Aplicación, firma, archivos y PDF | Transacción inmutable, recibo repetible, cifrado, versionado de archivos y prueba PDF | Referencia exacta del formulario, declaraciones y firma; Storage real, PDF final, descarga y doble envío HTTP |
| 9 | Traspaso incompleto bloqueado | Prueba SQL y botón deshabilitado en navegador | Revisión con checklist de cada producto |
| 10 | Admin asigna closer y recibe historial | Transición y asignación probadas con usuarios separados | Recorrido con sesiones Supabase de los cinco roles |
| 11 | Varias solicitudes y ofertas | Relaciones por solicitud/hilo, registro de ofertas y copias de documentos enviados | Dos lenders reales, hilos ambiguos y solicitud en portal externo |
| 12 | Aceptación distinta de desembolso | Prueba SQL exige oferta, aceptación previa y monto efectivo; no mueve dinero | Confirmación operativa y evidencia del lender |
| 13 | Acceso directo respeta permisos | RLS probada para casos, contactos, empresas, archivos y métricas; AAL1 denegado; acceso a Gmail no concede casos | Pruebas contra endpoints Supabase Auth/Storage reales y URLs firmadas vencidas |
| 14 | Seller conserva solo su visibilidad | Negociaciones y adjuntos posteriores al traspaso ocultos incluso en un hilo previo; lectura de fase seller preservada | Múltiples sesiones y mensajes enviados directamente desde Gmail |
| 15 | Celular, computador, español e inglés | Navegador: creación, nota, cambio de idioma y ficha móvil sin desbordamiento horizontal | Dispositivos físicos, instalación PWA, Safari/iOS y accesibilidad con equipo usuario |
| 16 | Tareas, alertas y preferencias sin push | Persistencia, deduplicación y canales independientes implementados | SMTP de invitaciones, remitente de alertas, VAPID y rechazo de permiso push |

## Límites actuales de la entrega

- El formulario público es una implementación inicial, no una reproducción validada del formulario previo. Incluye firma escrita; no se ha incorporado un campo SSN. La recepción real está deshabilitada por configuración.
- Excel admite XLSX y CSV; XLS binario requiere conversión. El informe enumera filas procesadas; filas vacías descartadas y encabezado deben considerarse al compararlo con el archivo original.
- El editor de campaña admite un mensaje inicial y hasta 20 seguimientos, con esperas de 1 a 90 días y vista previa de todos los pasos.
- Las páginas de oportunidades se paginan. Dentro de cada página se cargan hasta 3.000 registros relacionados y los últimos 1.000 mensajes; cada conversación permite cargar mensajes anteriores. La lectura de mensajes antiguos pausa la actualización automática hasta volver al historial reciente. Los indicadores se calculan sobre todo el universo autorizado y filtrado.
- El catálogo permite crear y editar lenders y guardar referencias documentales en las notas. No convierte guidelines en reglas, conforme a la fase posterior del PRD.
- El PDF usa las fuentes estándar de PDF para texto latino. Debe validarse contra los caracteres del formulario real; caracteres fuera de esa cobertura requieren incorporar una fuente Unicode antes de producción.
- Las comprobaciones SQL usan Postgres embebido con Auth/Storage simulados. No equivalen a una auditoría de seguridad ni a pruebas completas contra una instancia de Supabase.
- El usuario realizó el despliegue Docker/Coolify. No se enviaron desde este entorno correos, solicitudes a lenders ni verificaciones pagas reales.

## Recorrido de lanzamiento

1. Aplicar migraciones en staging, configurar Auth y crear cinco usuarios con MFA. Probar acceso directo y separación por áreas antes de ingresar información real.
2. Cotejar el formulario original, declaraciones y firma. Presentar una aplicación ficticia, recargar tras perder la respuesta, verificar un único recibo, adjuntos y PDF.
3. Conectar una sola cuenta Gmail. Revisar contenido y límites. Verificar destinatarios controlados con Bouncer y ejecutar una secuencia corta.
4. Probar respuesta, baja, rebote, revocación OAuth y envío de resultado incierto. Revisar que no se repitan mensajes ni créditos de scrub.
5. Completar documentos, análisis, traspaso, dos solicitudes a lenders, ofertas, aceptación y desembolso ficticio. Verificar las cinco vistas de permisos.
6. Ejecutar la carga de 50.000 filas en el servidor destino, observar memoria y tiempo y reiniciar el worker a mitad del lote. Comparar cantidades y duplicados.
7. Validar alertas, correo e instalación móvil; activar las demás cuentas solo después del recorrido completo y de medir costos.
