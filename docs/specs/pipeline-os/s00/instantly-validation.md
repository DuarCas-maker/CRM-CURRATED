# S00-INS: protocolo de validación de Instantly

**Actualización al 27/10/2026:** A/R completado con **11 acumuladas** y scopes declarados aceptados por panel/operador; [ejecutor B](instantly-phase-b.md) implementado y probado offline, B-FR01–08/B-AC01–08 cubiertos en 29 casos y regresión256/256. Fuente real11 y constancia idénticas, sin HTTP o carga de credenciales. Presupuesto vigente propuesto B:19–20 normales, N20/R3/H2 hasta25 nuevas y **36 acumuladas** desde la base real11; no se transfiere el intento A restante. Sustituye únicamente el supuesto conservador de base12 para el total acumulado de B; los máximos por fase del plan original conservan su contexto. INS-T02-B completado; INS-T03/C, INS-T05 real y INS-T06/D pendientes. Este incremento no autoriza ejecución.

26 de octubre de 2026, America/Bogota. **Protocolo SDD STRICT**, con spec-driven-development y automation-engineer, dentro de T00-04/RF09/RF12/RF13/RF27/RF29. Solicitud inicial: preparar protocolo, aceptación y presupuesto; revisar lo configurado, **sin llamadas reales o activar envíos**. Este documento no autoriza operaciones externas. Incremento posterior autorizado: [ejecutor A y aceptación offline](instantly-phase-a.md); B/C, receiver y aceptación real siguen pendientes.

Referencias internas: [spec](../spec.md), [diseño](../design.md), [tareas](../tasks.md), [evidencia](../verification.md), [inventario anterior](inventory.md). Composio está validado en92 acumuladas y no se vuelve a consultar para este bloque.

## 1. Descubrimiento: configuración y arquitectura actuales

- Stack inspeccionado: Next16.3.8/React19.3/TypeScript7, Node22, pnpm11; jobs/outbox y worker existentes. Sin SDK de Instantly o integración de campañas Instantly en src/worker. No se propone otra arquitectura de aplicación para S00.
- s00-connections.ts comprueba workspace/cuentas y s00-inventory.ts inventaría plan/cuentas/claves, usando API v2. Son comprobadores conjuntos que también contactan otros proveedores; **no ejecutarlos para esta nueva prueba**. El transporte de inventario conserva su allowlist de lectura.
- Revisión local con la carga interna ya autorizada de `.local/pipeline-os/s00.env`: INSTANTLY_API_KEY, INSTANTLY_WORKSPACE_ID y S00_TEST_RECIPIENT_EMAIL presentes; clave apta para header, workspace con forma UUID, correo de prueba con forma válida. Solo booleanos, sin imprimir valores, HTTP o editar archivo. No se cargó.env.local.
- Inventario previo: workspace esperado y suscripción Outreach, límite declarado25.000 contactos;32 cuentas con paginación completa,27 status1 y5 status-1. No se repararon/activaron cuentas. Los buzones Instantly no coincidían con M1/M2 Composio en esa muestra; no intercambiar sus IDs/estadísticas.
- El listado anterior de claves tenía cursor y no identificó la clave usada. **Scopes efectivos actuales desconocidos**; no sumar permisos de otras claves. available_credits=0 era crédito de otro producto, no cuota disponible de contactos o envío.
- La preparación de una segunda dirección controlada y un receiver HTTPS propio corresponde a sus fases; no se asume que ya estén configurados ni se piden claves otra vez por rutina.

El estado remoto se volverá a comprobar únicamente cuando se autorice ejecutar. Tener valores presentes no acredita autenticación actual, scopes, saldo, plan vigente o capacidad operativa.

## 2. Objetivo y alcance por fases

Demostrar viabilidad para administrar campañas desde el CRM, conservando control individual y autenticidad de eventos. Se separan evidencias de permisos/estado/configuración de evidencias de envío/recepción real.

| Fase  | Entregable propuesto                                                                                                                    | Efectos externos permitidos solo tras autorización futura                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INS-A | Workspace/plan, clave actual cuando identificable, cuentas, tipos de evento y búsqueda de campaña de prueba.                            | Solo GET de metadatos, sin recursos nuevos.                                                                                                                                |
| INS-B | Una campaña dedicada en estado no emisor, horario/secuencia, dos leads controlados, paginación y aislamiento de actualización por lead. | Crear/configurar/pausar solo esa campaña y crear/actualizar solo sus dos leads. Cero remitentes asignados, activaciones o envíos.                                          |
| INS-C | Entrega técnica autenticada de webhook, lectura de su log y limpieza de esa suscripción.                                                | Crear un webhook limitado a esa campaña/receiver propio, un test sintético y eliminar únicamente ese webhook de prueba autorizado. No prueba una respuesta comercial real. |
| INS-D | Envío/respuesta y detención operativa real o alternativa segura demostrada.                                                             | **Fuera de las autorizaciones A/B/C**: protocolo y presupuesto propios después de A/B/C, con remitente/agenda/destinatarios/gasto/máximo de mensajes revisados.            |

El alcance actual es **preparar** A/B/C, no implementarlos o ejecutarlos. No se modifican campañas/cuentas/webhooks existentes, Composio, TextTorrent, Bouncer, DB, producción, warmup, facturación, planes, claves o scopes. No verificación/enrichment/IA/compra de leads/dominios. La integración UI/worker es S05; las bajas de grupo y coordinación central permanecen en S01/S06.

## 3. Hallazgos del contrato oficial y decisión INS-ADR01

Fuentes primarias revisadas el26 de octubre; la documentación demuestra contrato publicado, no permisos del workspace:

| Fuente                                                                                                                                                 | Hallazgo relevante                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Create campaign](https://developer.instantly.ai/api-reference/campaign/create-campaign)                                                               | POST /api/v2/campaigns requiere name y campaign_schedule y responde200; email_list son **remitentes**, no la audiencia. La audiencia son entidades Lead separadas.                                                   |
| [Campaign schema](https://developer.instantly.ai/api-reference/schemas/campaign)                                                                       | status es read-only, con enum numérico sin etiquetas en la página revisada. stop_on_reply y stop_for_company tienen propósitos distintos. No tomar status1 del ejemplo como prueba de borrador/pausa.                |
| [Pause campaign](https://developer.instantly.ai/api-reference/campaign/stopor-pause-a-campaign)                                                        | POST /campaigns/{id}/pause está documentado para campaña completa. No es pausa individual.                                                                                                                           |
| [Create lead](https://developer.instantly.ai/api-reference/lead/create-lead)                                                                           | POST /leads permite campaign, email, custom_variables y flags de verificación. Responde200. Ambos verify_leads_on_import y verify_leads_for_lead_finder se fijarán false.                                            |
| [Patch lead](https://developer.instantly.ai/api-reference/lead/patch-lead) y [Lead schema](https://developer.instantly.ai/api-reference/schemas/lead)  | La petición admite datos/variables/estado de interés; status operacional figura read-only. No se inventa PATCH status2 para pausar. Cambiar interés o una variable no demuestra cese de envíos.                      |
| [List leads](https://developer.instantly.ai/api-reference/lead/list-leads)                                                                             | Es POST /leads/list de **lectura**, con campaign, limit, starting_after y distinct_contacts. Hay eventual consistencia de búsqueda: un vacío inmediato no prueba ausencia y no autoriza recrear un lead.             |
| [List campaign](https://developer.instantly.ai/api-reference/campaign/list-campaign)                                                                   | Permite search por nombre y cursor; reconciliar creación por nonce exacto, no reutilizar cualquier coincidencia parcial.                                                                                             |
| [List API key](https://developer.instantly.ai/api-reference/apikey/list-api-key)                                                                       | Lista paginada con scopes; puede devolver claves. Comparar solo en memoria la clave exacta actual y descartar los demás datos. Si está enmascarada/no encontrada, registrar desconocido.                             |
| [Create webhook](https://developer.instantly.ai/api-reference/webhook/create-webhook)                                                                  | Tiene filtro campaign y headers personalizados. Se puede diseñar autenticación con secreto de transporte por header; no asumir HMAC inexistente.                                                                     |
| [Webhook payload](https://developer.instantly.ai/guides/webhook-events)                                                                                | Incluye contexto workspace/campaign/event_type y campos opcionales de correo/respuesta, que pueden contener datos personales. No registrar payload completo.                                                         |
| [Test webhook](https://developer.instantly.ai/api-reference/webhook/test-a-webhook)                                                                    | POST /webhooks/{id}/test entrega un payload sintético; success/status_code y captura del receptor deben concordar. No equivale a reply_received de un lead real.                                                     |
| [List webhook events](https://developer.instantly.ai/api-reference/webhookevent/list-webhook-event)                                                    | GET paginado, filtrable por search de URL exacta/lead y rango de fechas; usar solo el receiver dedicado. IDs de entrega/reintento no equivalen necesariamente a mensaje de negocio.                                  |
| [Contactos del plan](https://help.instantly.ai/en/articles/7918680-uploaded-contacts-limits)                                                           | Los contactos de campañas borrador/pausadas también consumen el límite fijo de contactos cargados. No es un cupo mensual que se renueva. Confirmar dos posiciones disponibles antes de INS-B; no comprar ampliación. |
| [Rate limits](https://developer.instantly.ai/getting-started/rate-limit) y [List email](https://developer.instantly.ai/api-reference/email/list-email) | Límites del workspace y restricciones particulares por endpoint; listar emails tiene20/min. No hacer prueba de saturación ni usar el límite general para todos los endpoints.                                        |

**INS-ADR01: control por lead sin endpoint inventado.** El contrato revisado no demuestra una mutación pública de pausa individual. Se adopta como modo de diseño provisional ya previsto en el plan **una sola etapa de envío por campaña/turno, con siguientes intentos liberados por el coordinador CRM**. Sin secuencia autónoma multietapa compitiendo con SMS/CRM. Se configura stop_on_reply=true, stop_for_company=false, sin interpretar esos flags como prueba suficiente de detención.

INS-B solo comprobará que una actualización de variables del lead A no modifica B; se llamará **aislamiento de actualización**, no pausa efectiva. La variable técnica propuesta s00_hold=true no tiene semántica de scheduler en Instantly. El coordinador futuro debe bloquear la siguiente liberación por respuesta/baja y reservar envío con estado actual antes de despachar; se probará offline. No se marca este mecanismo integrado o operativo por escribir una variable.

Para cerrar T00-04 con secuencias automáticas se necesita demostrar detención individual real. Si no se acredita, deberá aceptarse explícitamente la alternativa de pasos únicos y completar INS-D que pruebe respuesta/control y el contrato del coordinador; A/B/C no cierran ese requisito por sí solos. No se altera el requisito de seguimiento del usuario o de baja global.

## 4. Requisitos y reglas

| ID       | Requisito                                                                                                                                                               | AC             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| INS-FR01 | Reusar credenciales guardadas con workspace fijado; inspección de presencia distinta de verificación remota; permisos de **la clave actual** o desconocidos explícitos. | INS-AC01/02    |
| INS-FR02 | Separar autorización/contador por fase; modo offline por defecto y cero recursos/API en la preparación actual.                                                          | INS-AC03/13    |
| INS-FR03 | Una campaña dedicada por nonce, cero remitentes/tags de remitentes/CC/BCC, sin activar/resumir o enviar tests de email; pausar y comprobar estado antes de audiencia.   | INS-AC04/05    |
| INS-FR04 | Dos contactos controlados distintos, sin verificación pagada, identidad/workspace/campaña fijados; paginación completa e importación incierta sin duplicados.           | INS-AC06/07    |
| INS-FR05 | Distinguir actualización individual, estado de interés y detención de despacho; validar aislamiento A/B y documentar los límites/alternativa.                           | INS-AC08/14    |
| INS-FR06 | Eventos técnicos autenticados, contexto correcto, persistencia/duplicados/reconciliación; test sintético separado de respuesta real.                                    | INS-AC09/10    |
| INS-FR07 | Reservar antes de HTTP, no retry ciego de mutación, reservas protegidas y recuperación explícita sin ampliar techo o crear recursos extra.                              | INS-AC11/12    |
| INS-FR08 | Reporte sanitizado, cierre de cada fase, trazas conservadas y limpieza solo autorizada de recursos propios, sin cambios de app o datos ajenos.                          | INS-AC12/13/14 |

No funcionales: timeout8s, origen HTTPS fijo api.instantly.ai, redirecciones manuales, cuerpos de respuesta acotados (propuesto2MiB), JSON validado, scopes mínimos, intervalos conservadores≥1s entre solicitudes y backoff≥5s/Retry-After. Un429 no autoriza más consumo; una espera exigida>60s detiene para revisión. Errores401/402/403 y datos/identidad inválidos no se reintentan. No copiar claves o datos reales a documentación, tests, logs, URLs de depuración o reportes.

## 5. INS-A: acceso y descubrimiento acotados

Precondiciones futuras: ejecutor/test offline terminados, carga interna de s00.env autorizada, clave/UUID seguros y autorización específica de hasta12 nuevas para esta fase. Fijar hash de clave/workspace y nonce del ensayo; no rotar clave durante una fase ni confundirlo con otra organización.

Orden:

1. GET /workspaces/current: coincidencia exacta de workspace, o parar.
2. GET /workspace-billing/plan-details: plan presente y límites declarados, sin comprar o usar available_credits como cupo de contactos.
3. GET /api-keys?limit=100, máximo3 páginas, hasta encontrar exactamente la clave actual o agotar el límite. Sin crear/revocar claves ni imprimir respuestas. Si403 o no se puede identificar la clave, registrar flags de scopes como desconocidos y no habilitar escrituras: el operador podrá confirmar la asignación en el panel por un mecanismo revisable, ligado a la huella actual. No pedir otra clave salvo falta de permiso acreditada.
4. GET /accounts?limit=100, máximo2 páginas; solo conteos/flags, sin cambiar/reparar/pausar cuentas o warmup. Código de estado no reconocido queda desconocido. Si el inventario no cabe, declarar incompleto y parar antes de fases con efecto.
5. GET /webhooks/event-types: registrar disponibilidad de reply_received/bounced/unsubscribed y tipos necesarios; no implica estar suscrito o recibirlos.
6. GET /campaigns?search=S00-INSTANTLY-<nonce>&limit=100, máximo2 páginas; comprobar ausencia de una campaña con ese nonce antes de una futura creación, sin modificar las encontradas.

Scopes a resolver: lectura de workspace/plan/cuentas/campañas/tipos de evento; api_keys:read solo para ese método opcional de identificación. Para B, campaigns:create/read/update y leads:create/read/update, o equivalentes agregados **de la misma clave**. Para C, webhooks:create/read/delete y lectura de webhook_events según scopes vigentes de sus endpoints. No pedir all:all por comodidad o deducir privilegios de un200 en otro recurso. Cada operación real confirmará solo su capacidad.

## 6. INS-B: campaña y audiencia sin capacidad de emisión

Precondiciones adicionales: A suficiente, autorización explícita de crear/configurar/pausar una campaña y dos leads, hasta25 nuevas de B, dos posiciones de contactos incluidas disponibles y dos emails controlados distintos. El A puede reutilizar S00_TEST_RECIPIENT_EMAIL; para B se preparará un campo privado INSTANTLY_S00_CONTROL_EMAIL, sin asumir que un alias + funciona. No son remitentes, no requieren que M1/M2 estén en Instantly.

Secuencia presupuestada:

1. Releer workspace y plan para evitar drift entre autorizaciones (2GET).
2. Buscar nonce exacto otra vez (1GET normal; cualquier continuación/reconciliación consume R).
3. Crear una campaña con nombre nonce, campaign_schedule obligatorio y arrays email_list/email_tag_list/cc_list/bcc_list vacíos, sequences vacía inicialmente, sin activation (1POST).
4. Leer esa campaña (1GET). Ningún remitente directo, por tag o routing debe quedar asignado. Si el contrato omitiera un campo indispensable para demostrarlo, bloquear antes de audiencia.
5. POST /campaigns/{id}/pause y GET del mismo ID (2). No PATCH status. El enum de las páginas actuales no mapea números a etiquetas: no asumir status1=borrador. Antes de añadir leads se deberá fijar el mapeo con fuente oficial suficiente o confirmación del operador en el panel, además de respuesta200 de pause y GET coherente. Si no se acredita estado no emisor, bloquear. Si el proveedor rechaza pausar un borrador, conservarlo sin remitentes y revisar el contrato; **no activarlo para conseguir pausarlo**. La ausencia de remitentes y ausencia de activate son guardas independientes de ese mapeo.
6. PATCH /campaigns/{id} con horario de prueba explícito y una única secuencia de un paso ficticio, stop_on_reply=true, stop_for_company=false, sin referencias de remitentes; GET para verificar la configuración (2). No conectar AI sales agents, subsecuencias, evergreen o enriquecimientos. No añadir segundo paso para probar follow-up.
7. Crear leads A y B uno a uno, con campaign fijado y marca nonce en custom_variables (2POST). verify_leads_on_import=false y verify_leads_for_lead_finder=false, skip_if_in_workspace=true y skip_if_in_campaign=true. Si se omiten/ignoran esos controles o el contacto ya existe, detener y no duplicarlo moviendo/saltando protecciones. No recrear ante timeout.
8. GET de A y B para fijar identidad y asociación (2GET). Los dos deben ser del workspace/campaña nuevos y corresponder a direcciones aprobadas.
9. POST /leads/list con campaign, limit1 y distinct_contacts=false, hasta3 lecturas, cursando con starting_after del último ID hasta fin (2–3). Validar conjunto exacto A/B y ausencia de repetidos. Una página parcial no acredita inventario completo; una respuesta vacía transitoria no dispara importación nueva.
10. PATCH solo A con una variable de prueba s00_hold=true (1), seguido de GET A y GET B (2): A cambia, B conserva su asociación/variables/estado. Esta operación **no acredita pausa del scheduler**.
11. GET final de campaña (1): mismo recurso, estado no emisor y arrays de remitentes vacíos. Conservar como prueba pausada y no eliminar leads/campaña automáticamente.

Cada recurso se conserva en un manifest privado; no inferir propiedad por un ID que aparezca en un webhook. El operador no debe editar/activar la campaña del ensayo mientras corre. Una discrepancia detiene y, si procede, usa H para pausar solo el ensayo. Si hay otro actor que haya añadido un remitente, no continuar con ningún paso ni sobrescribir configuraciones ajenas a ciegas.

Ejemplo de contenido de lead **solo ficticio y no ejecutable**:

```json
{
  "campaign": "00000000-0000-4000-8000-000000000001",
  "email": "test-recipient@example.invalid",
  "skip_if_in_workspace": true,
  "skip_if_in_campaign": true,
  "verify_leads_on_import": false,
  "verify_leads_for_lead_finder": false,
  "custom_variables": { "s00_run": "NONCE_FICTICIO", "s00_alias": "A" }
}
```

No usar esa dirección o UUID para llamadas reales. El payload final y su horario deberán fijarse en la implementación offline usando el contrato vigente; su aprobación se asocia al hash antes de ejecutar. No inventar fechas/horarios defaults para campañas del producto, ni interpretar daily_limit0 como barrera de seguridad.

## 7. INS-C: webhook técnico, sin correo

Precondiciones: B cerrado sin emisión, receiver HTTPS **propio/controlado** preparado y probado offline, autorización específica de suscripción/test/DELETE del webhook nuevo, hasta15 nuevas de C. Propuestos INSTANTLY_S00_WEBHOOK_URL y secreto dedicado INSTANTLY_S00_WEBHOOK_SECRET: no se crean ni configuran hoy. No publicar receiver o cambiar DNS/proxy/infra sin su alcance autorizado. No usar un collector público de terceros con datos de leads ni enviar al receiver la API key.

Orden presupuestado: workspace1, GET campaña/guardas1, POST webhook1 limitado a esa campaña, GET webhook1, POST test1, GET logs por URL exacta y ventana1–2, GET detalle de ese evento1, DELETE solo ese webhook1 y GET para confirmar404 esperado1. Total9–10 normales. El body de test es sintético; puede no representar el mismo contexto del lead o campaña. Si contexto/test no coinciden, guardar resultado técnico o cuarentena y no tratarlo como respuesta de A.

Auth propuesta: header secreto aleatorio independiente, enviado mediante headers documentados del webhook y comparado de forma constante en el receiver. HTTPS y validación workspace/campaña/tipo, límite de tamaño y persistencia antes de responder2xx. No se declara firma HMAC del proveedor. Token ausente/incorrecto o contexto ajeno no puede ordenar pausas/dispatch. Si no se puede verificar autenticidad/contexto, eventos quedan como indicios y se corroboran por API antes de afectar negocio.

Verificar que llegó la entrega con el header esperado y que el test informa resultado HTTP coherente; success=true aislado no demuestra recepción durable. Los fixtures cubren token malo, replay, fuera de orden, schema inválido y disco caído. Replays locales no llaman API ni se cuenta cada entrega del proveedor como una petición saliente del ejecutor; registrar ese número aparte. No invocar de nuevo test para conseguir una segunda lectura.

El ID de webhook_event puede ser de intento de entrega; no basta para deduplicar respuestas de negocio. Usar identidad de mensaje estable/contexto cuando exista; sin ID suficiente, revisión/reconciliación antes de un mensaje canónico. No deduplicar respuestas solo por asunto, cuerpo, email del lead o timestamp. Contenido textual se descarta para este ensayo; solo flags y metadatos necesarios, sin payload/headers secretos en logs. INS-D deberá fijar el contrato real de reply/email IDs y la correlación con Gmail por separado.

Borrar el webhook nuevo es parte del protocolo futuro que requiere aprobación; nunca hooks existentes o una operación masiva. Si DELETE queda incierto, conciliar por GET, sin repetirlo ciegamente. El receiver deja de aceptar como activos eventos de ese ensayo cerrado; los reintentos ya en vuelo se rechazan/cuarentenan sin generar negocio nuevo. No se promete retirar un mensaje/callback ya en tránsito.

## 8. Presupuesto por fase

Cada HTTP del ejecutor cuenta, incluso errores y POST de lectura. Paginación, reintentos y conciliaciones tienen límites; documentación pública consultada y validaciones offline no son llamadas a la API del workspace.

### INS-A: lectura

| Operación                               | Normales |
| --------------------------------------- | -------: |
| Workspace + plan                        |        2 |
| Clave actual, máximo3 páginas           |      1–3 |
| Cuentas, máximo2 páginas                |      1–2 |
| Tipos de evento                         |        1 |
| Búsqueda campaña nonce, máximo2 páginas |      1–2 |
| **Normal**                              | **6–10** |
| Reserva R de lectura                    |    **2** |
| **Máximo A**                            |   **12** |

### INS-B: borrador/pausa y dos leads

| Operación                                    |  Normales |
| -------------------------------------------- | --------: |
| Workspace/plan + búsqueda nonce              |         3 |
| Crear campaña y leer                         |         2 |
| Pausar y leer                                |         2 |
| Configurar un paso/horario y leer            |         2 |
| Crear A/B y GET A/B                          |         4 |
| Paginación audiencia limit1                  |       2–3 |
| Actualizar variable de A + GET A/B           |         3 |
| GET final de campaña                         |         1 |
| **Normal**                                   | **19–20** |
| Reserva R: lecturas/conciliación             |     **3** |
| H protegido: pausa del ensayo + comprobación |     **2** |
| **Máximo B**                                 |    **25** |

### INS-C: entrega técnica

| Operación                                            | Normales |
| ---------------------------------------------------- | -------: |
| Workspace + campaña                                  |        2 |
| Crear webhook + GET + un test                        |        3 |
| Logs filtrados + detalle                             |      2–3 |
| Eliminar webhook propio + GET404                     |        2 |
| **Normal**                                           | **9–10** |
| Reserva R: lecturas/conciliación                     |    **3** |
| H protegido: limpieza del hook propio + comprobación |    **2** |
| **Máximo C**                                         |   **15** |

**A+B:25–30 normales, hasta37 con reservas. A+B+C:34–40 normales, hasta52 con reservas.** Son techos nuevos propuestos por fase, no autorizados. Aprobación A12 no autoriza B o C. Si se autorizara el conjunto máximo, el contador del bloque deberá respetar además12/25/15; saldo no usado de una fase no aumenta otra. No sumar52 a92 como si fuera un acumulado Composio, ni usar sus cinco slots sobrantes para Instantly.

Una autorización humana explícita del conjunto A/B/C, con sus efectos y manifiestos ya preparados, puede cubrir las tres fases; no se vuelve a pedir el mismo permiso al avanzar dentro de ese alcance. Autorización exclusiva de lectura A no cubre crear recursos, suscribir callbacks o limpiar el webhook.

El contador del nuevo protocolo empieza en cero **nuevas** para este bloque; el historial de inventarios Instantly previos se conserva, sin inventar un acumulado completo no disponible. El reporte mostrará consumo nuevo por proveedor/fase y su evidencia de origen. Composio permanece92 sin nuevas consultas. INS-D no está incluido en52 ni tiene permiso de activación/envío; se presupuestará tras resolver acceso/control/captura y definir cuántos mensajes reales se autorizan.

Reserva antes de cada HTTP y de cada mutación. Antes de crear recursos, comprobar que caben todos los pasos restantes y H protegido. Retry de **lecturas** solo red/429/5xx, máximo uno por operación y techo global R de su fase. POST create/activate/test, PATCH y DELETE no se repiten a ciegas. Para resultado incierto, una lectura de conciliación por recurso/nonce dentro de R; si no identifica un único recurso/efecto, detener. No crear campaña/lead/webhook de reemplazo porque faltó respuesta. Reservar token/nonce y trace IN_FLIGHT antes de enviar; un reinicio no repone cuotas.

H de B solo puede pausar el ID de la campaña nueva y comprobarlo; H de C solo puede limpiar el webhook nuevo y comprobarlo. No se gasta H en diagnósticos o páginas adicionales. Si no cabe recuperación/cierre, detener antes de crear más recursos. Si el techo se agota, no emitir otra solicitud para completar un reporte.

## 9. Diseño técnico propuesto: INS-ADR02

Extender el paquete S00 con un ejecutor aislado **solo Instantly** (s00-instantly-runner.ts/CLI/files), reusando patrones de clocks inyectados, validación Zod, timeout y persistencia probados. No ampliar la allowlist antigua de inventario para mutar ni usar SDK con llamadas implícitas. El [incremento A](instantly-phase-a.md) implementa únicamente lecturas y QA offline, sin librerías nuevas ni cambios de arquitectura del CRM; las otras fases no están implementadas.

Un journal autoritativo propuesto `.local/pipeline-os/s00-instantly-run.json`, privado/ignorado y versionado: huella clave/workspace, hash del manifiesto/payload aprobado, fase/subfase, nonce, IDs propios, scopes confirmados/desconocidos, counters N/R/H, requests reservadas y resultados, proofs/capacidades y pendientes. Referenciar evidencia histórica de inventario sin alterar journals Composio. El archivo no se crea durante planificación. Un reporte separado es derivado, no otro contador.

Locks/archivos wx, fsync y rename, límite de tamaño, sin eliminar temporales/locks ajenos. Modo status por defecto sin env, directorios o red; execute requiere fase/autorización/techo específico. Los flags no conceden permiso humano. Identidad mismatched, cambio de workspace/payload/key o recursos ajenos bloquean. Destinatarios y receiver se resuelven privadamente antes de autorizar efectos, nunca por el primer elemento de un listado.

Receptor técnico se prepara en fixtures sin despliegue. Sin migraciones DB en S00; S05 integrará el flujo en persistencia durable/jobs/outbox existentes. No afirmar semántica productiva del asistente, cola, métricas o bajas porque una prueba standalone funcione.

## 10. Aceptación y pruebas

| AC       | Dado / cuando / entonces                                                                                                                 | Prueba requerida                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| INS-AC01 | Dado config presente, cuando se inspecciona offline, entonces solo presencia/forma, sin HTTP o afirmación de permiso.                    | Sentinelas, campos ausentes/malformados y modo CLI offline.                                              |
| INS-AC02 | Dado scope de una clave distinta/no identificada, entonces no atribuirlo a la actual; workspace distinto bloquea.                        | Clave en otra página, enmascarada,403, cursor repetido y organización equivocada.                        |
| INS-AC03 | Dada autorización A o ninguna, cuando se pide B/C/activate/send/otra URL, entonces cero operación no aprobada.                           | Gates de fase, origen/ruta/método, redirects y cambio de huellas.                                        |
| INS-AC04 | Dado POST campaña incierto, cuando se concilia, entonces recurso único por nonce o parada sin duplicación.                               | Timeout/crash, búsqueda parcial/ambigua y conteo de POST≤1.                                              |
| INS-AC05 | Dada campaña del ensayo, antes de audiencia y al cerrar, entonces ausencia de remitentes y estado no emisor acreditados; nunca activate. | Campos omitidos, tags/routing inesperados, mapeo status no acreditado y pausa de emergencia.             |
| INS-AC06 | Dados dos contactos aprobados, cuando se importan, entonces exactamente A/B, flags paid=false y workspace/campaña correctos.             | Duplicados, cuota no confirmada,401/402/403, respuesta incierta y contactos ya existentes.               |
| INS-AC07 | Dadas páginas de un lead, entonces obtener dos IDs únicos y fin comprobado, sin recrear por búsqueda eventual.                           | Dos/tres páginas, cursor repetido, parcial, respuesta vacía temporal y mezcla de campañas.               |
| INS-AC08 | Dado PATCH de variable de A, entonces B no cambia y no se declara pausa efectiva por ese cambio.                                         | Snapshot A/B, fields read-only bloqueados y operación fuera de recursos propios.                         |
| INS-AC09 | Dado webhook, cuando llega una entrega, entonces header/contexto válidos y persistencia antes de2xx; inválidos no ordenan negocio.       | Secreto malo/ausente, workspace ajeno, schema/tamaño, fallo de disco y test sintético fuera de contexto. |
| INS-AC10 | Dado replay/log de entrega, entonces no duplicar un hecho de prueba ni confundir deliveryID con replyID estable.                         | Repetición, fuera de orden, ID insuficiente y payload de test separado de respuesta real.                |
| INS-AC11 | Dado máximos A12/B25/C15, entonces no superar ninguno ni52 del conjunto propuesto, incluyendo fallos.                                    | Casos mínimos/máximos, H protegido, última llamada fallida y ninguna extra de reporte.                   |
| INS-AC12 | Dado cierre o fallo, entonces preservar trazas/recursos ajenos y conciliar solo los propios; cleanup de hook específicamente aprobado.   | Locks, crash, downgrade/reset, DELETE incierto y GET404 de cleanup.                                      |
| INS-AC13 | Dado reporte, entonces sin claves/emails/IDs/URL/header/body privados, con distinción no probado/no permitido/falló.                     | Redacción/sentinelas, status/replay offline y pruebas sin env reales.                                    |
| INS-AC14 | Dadas A/B/C completadas, entonces no cerrar respuesta/detención real hasta INS-D o alternativa validada/aceptada.                        | Matriz de capacidades y límites; sin estado agregado verde por simples200 o eventos sintéticos.          |

## 11. Tareas, rollout y compensación

| ID      | Objetivo / FR                                                      | Dependencias                                                                                                    | Terminado y evidencia                                                                                                             |
| ------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| INS-T01 | Contrato, alcance, AC y presupuesto FR01–08.                       | Inventario/código/configuración/docs oficiales.                                                                 | Protocolo revisado, trazabilidad y cuentas; preparado en esta entrega.                                                            |
| INS-T02 | Implementar ejecutor/CLI/journal y fixtures sin red FR01–05/07/08. | T01 y autorización de implementación.                                                                           | Gates A/B/C, recursos propios, seguridad no envío, privacidad y reservas; tests offline. Pendiente.                               |
| INS-T03 | Preparar receiver/eventos/dedup y revisión FR06–08.                | T02; sin infraestructura pública todavía.                                                                       | Pruebas de auth/replay/crash/fallos, typecheck/formato/suites S00 y revisión, sin red. Pendiente.                                 |
| INS-T04 | Ejecutar A y documentar permisos desconocidos/reales.              | T02 y su QA de lectura, autorización A12; receiver de C no requerido.                                           | Workspace fijado, scopes/capacidades/readiness y bloqueos claros. Pendiente.                                                      |
| INS-T05 | Ejecutar B y C dentro de sus alcances aprobados.                   | T04; destinatarios/quota/estado para B; T03 y receiver preparado para C; permisos B25/C15 o conjunto explícito. | Recursos propios, no envío, audiencia/paginación/aislamiento, entrega técnica y cleanup; evidencia limitada explícita. Pendiente. |
| INS-T06 | Resolver detención/INS-D y consolidar T00-04.                      | T04/05, resultados de capacidad, protocolo/autorización específica de mensajes si hacen falta.                  | Viabilidad real/alternativa aceptada con evidencia, sin mezclar configuración y operación. Pendiente.                             |

Rollout: implementación/QA offline → aprobación y lectura A → completar datos/permisos requeridos → aprobación B sin emisión → receiver propio/autorización C → propuesta revisada INS-D. No se genera ahora recurso o permiso para otra fase.

Compensación: dejar campaña del ensayo sin remitentes/pausada si B falla, preservar IDs/trazas y registrar si la pausa remota quedó desconocida. No pausar cuentas/campañas ajenas o afirmar que una bandera local detuvo proveedor. Con C, limpiar exclusivamente el webhook propio dentro de la operación autorizada y mantener receiver cerrado para negocio del ensayo. Eliminar campaña/leads para recuperar cuota requiere alcance explícito posterior, no se añade a escondidas al presupuesto. Antes de implementación puede retirarse el paquete propuesto sin tocar datos. Tras una futura ejecución, no borrar journals para resetear consumo. No hay mensaje enviado que revertir en A/B/C.

DB/migraciones remotas, nuevo framework, despliegue de producción y UI: no aplican a esta planificación. Si el contrato real difiere, registrar cambio SDD y recalcular peticiones antes de continuar; no ampliar el techo automáticamente. T00-04 y S00 siguen abiertos.

## Incremento INS-R: recuperación explícita del ensayo fallido

[Contrato/ADR/AC de recuperación](instantly-pagination-recovery.md), posterior al ensayo real detenido en4/12 por keys duplicadas. Implementado/QA offline, sin migrar la base real. Excepción explícita a la regla de no reanudar: solo modo de recuperación con snapshot inmutable v1→v2 del mismo ledger, huellas/nonce heredados, nuevas normales6 y reserva2, máximo8 nuevas/12 acumuladas. R cubre páginas siguientes accounts/campaigns y retries, compartida sin cuotas nuevas. Keys tiene una única muestra nueva sin cursor; duplicados/ambigüedad dejan scopes desconocidos, no se afirma reparar su paginación. La regla estricta de v1 se conserva. Futura ejecución requiere habilitación posterior; ahora cero APIs y contador real4 intacto. Aceptación real/B/C/D y T00-04/S00 continúan pendientes.
