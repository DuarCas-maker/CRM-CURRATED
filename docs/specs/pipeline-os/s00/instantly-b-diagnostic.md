# INS-BD: diagnóstico de lectura de campaña — SDD STRICT

28/10/2026. Modo implementación y QA offline autorizado. [Incidente](instantly-phase-b-incident.md): B v3 failed18/stage4/B_UNSAFE_CAMPAIGN, N5/R0/H2 y emergencia verified_paused;0 leads. No repetir el ensayo o inferir el campo fallido desde mocks. Rondas previas y solicitud actual cierran objetivo, recurso, privacidad y no ejecución; no quedan decisiones de negocio abiertas para esta implementación.

## Especificación y aceptación

Estado vigente29/10/2026: diagnóstico real BD-T04 completado; el desarrollo y la evidencia offline siguientes se conservan como antecedentes. Ver resultado operativo al final.

| FR      | Requisito                                                                                                              | AC Given/When/Then                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| BD-FR01 | Preservar exactamente B18 y toda su historia; mismo ledger, sin resets o downgrade.                                    | BD-AC01: dado B18 exacto, solo una futura ejecución autorizada puede extender a v4; fuentes reales siguen idénticas hoy.                       |
| BD-FR02 | Default/preview offline; gate futuro separado del permiso original de B.                                               | BD-AC02: status sin env/save/HTTP; execute exige B_DIAGNOSTIC/new2/total20/included/reviewed.                                                  |
| BD-FR03 | Solo GET de la campaña propia, con configuración/manifiesto/scope fijados e identidad comprobada.                      | BD-AC03: ID/nombre/workspace diferentes o ruta/query/método extra bloquean; cero mutaciones y cero llamadas a otros recursos.                  |
| BD-FR04 | Proyección fija de presencia/tipo/tamaño/igualdad por campo sin persistir respuestas, valores, claves dinámicas o PII. | BD-AC04: omisión/null/tipo/distinto/no vacío identificables; sentinelas no aparecen en reporte/journal nuevo fuera del snapshot histórico.     |
| BD-FR05 | 1 lectura y máximo1 retry transitorio; reservar durable antes de HTTP.                                                 | BD-AC05:18→19 o20, timeout8s/2MiB/redirects del transporte compartido;429/red/5xx con backoff≥5s, >60s detiene.                                |
| BD-FR06 | Idempotencia, almacenamiento y terminales conservadores.                                                               | BD-AC06: IN_FLIGHT/completed/failed no se reanudan; disco/locks/tmp/transiciones/cancelación no devuelven saldo ni repiten GET.                |
| BD-FR07 | Comparar estado actual pausado con la configuración inicial, sin concluir causa histórica o reparar B.                 | BD-AC07: completed del diagnóstico no completa B; mapeo temporal e identidad diferenciados, estado distinto a pausa se informa sin corregirlo. |

NFR: TS/Zod/Node22 existentes, sin SDK/dependencias nuevas, UI/DB/worker o despliegue. Sin env real, API, cambios del manifiesto/campaña, envíos o verificaciones pagas en este incremento. El resultado operativo y causa histórica siguen pendientes.

## Diseño y BD-ADR01/02

**ADR01 — continuidad del historial:** v4/phase B_DIAGNOSTIC en el mismo `s00-instantly-run.json`, snapshot completo v3 failed18 y sourceHash inmutables, manifiesto/scope ligados al mismo origen. Nuevo tramo18..20, techo original36 sin ampliación; no se reponen N/R/H de B. Adaptadores A/R/B rechazan v4 para efectos, CLI default proyecta v4. Sin un ledger alternativo. Migración real no se ejecuta durante desarrollo. Mismo lock wx y writes temporales wx/fsync/rename, sin borrar archivos ajenos. Rollback: retirar extensión local conservando cualquier ledger; jamás degradar v4 para volver a ejecutar B.

**ADR02 — diagnóstico, no reparación:** constructor cerrado a GET `/api/v2/campaigns/{campaignId}` del snapshot, sin parámetros; transporte compartido acotado. No consultar plan/workspace u otro recurso en este tramo. Clave/workspace deben coincidir con huella original. Respuesta valida identidad antes de conservar proyección; nunca se adopta un recurso diferente. Se comparan campos/booleans/arrays y schedule/sequences con el payload inicial solicitado en B, desglosando schedule por rutas fijas. Ausente/null no se normalizan a valores seguros; no se relajan las guardas de B.

Informe solo lista rutas de una enumeración fija, observedType, tamaño para objetos/arrays y reason(match/missing/null/wrong_type/non_empty/mismatch). No valores de IDs/emails/nombre/asunto/cuerpo/cursor/errores arbitrarios, ni nombres de claves desconocidas. Se informa si la campaña sigue pausada; cualquier otro estado detiene sin intentar pausar. Las diferencias son del GET actual después de la emergencia, no prueba del campo que causó el primer fallo; historicalFailureCauseProven=false siempre. B.failed permanece inmutable dentro del snapshot, incluso con diagnóstico completado y sin diferencias actuales.

## Tareas, validación y rollout

| T      | Objetivo / FR                                  | Dependencias                                              | Terminado / pruebas                                                                                                   |
| ------ | ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| BD-T01 | Contrato/AC/ADR/presupuesto, FR01–07.          | Incidente B18 y solicitud.                                | Completado: este documento antes de código,7 FR/AC y ADR01/02.                                                        |
| BD-T02 | Núcleo/proyección/estado/lectura, FR01/03–07.  | T01.                                                      | Completado offline:28 casos BD con fetch/reloj/store ficticios dentro de regresión284/284.                            |
| BD-T03 | Files/CLI/QA/preview real offline, FR01/02/06. | T02.                                                      | Completado: migración ficticia/legacy/CLI, TypeScript correcto;8 archivos reales idénticos, contador18 sin migración. |
| BD-T04 | Diagnóstico real y análisis de diferencias.    | T03, autorización específica2/20 y credenciales internas. | Completado29/10/2026: un GET,19 acumuladas; campaña pausada, tres omisiones; B no reanudada.                          |

Plan ejecutado: contrato → core → adaptadores → negativos y fallos → regresión/TypeScript/revisión → preview real sin env/save/HTTP. G0–G3 resueltos con incidente/código/alcance; G4/G5 completados con la evidencia final siguiente. G6 no aplica: no hay despliegue. Release remoto, DB y cleanup no aplican; riesgos de drift de proveedor, fuente cambiada y fallos de disco se manejan deteniendo, no normalizando o reiniciando.

## Implementación y verificación final

G4/G5 completados offline: [núcleo](../../../../scripts/pipeline-os/s00-instantly-b-diagnostic.ts), [files](../../../../scripts/pipeline-os/s00-instantly-files.ts), [CLI](../../../../scripts/pipeline-os/s00-instantly-runner-cli.ts), [fixture ficticia](../../../../tests/fixtures/pipeline-os-instantly-b-diagnostic.ts) y [pruebas](../../../../tests/pipeline-os-s00-instantly-b-diagnostic.test.ts). No se toca el comparador B, no se corrige ni normaliza una respuesta remota desconocida y no se añaden dependencias.

Regresión `tests/pipeline-os-s00*.test.ts` con Node22/tsx → **284/284,0 fallos/omitidas/canceladas**, incluidas **28 BD**. `tsc --noEmit --incremental false` correcto. Cubiertos: fuentes exactas y bindings, GET propio/headers/sin cuerpo, omisión/null/tipo/no vacío/normalización/clave dinámica, identidad ajena, estado ya no pausado,401/402/403/4xx/redirect/JSON inválido, red/429/5xx con máximo2 y Retry-After, stream y Content-Length>2MiB, timeout8s simulado, abort, fallos antes/después de HTTP, IN_FLIGHT/terminales sin retry, historial corrupto/downgrade/locks/tmp/tamaño de input y CLI fixture-only. Ausencia de ledger informa calls0/estado desconocido en lugar de inventar18 observadas. Los ejemplos que provocan una omisión son sintéticos, no evidencia de la causa real.

Preview sobre fuentes reales: `--check-b-diagnostic` → sourceCalls18/apiCalls0/bindingsValid=true; `--phase B_DIAGNOSTIC` → not_started/calls18/newCalls0. Verificación adicional con trampas env/fetch/save →0/0/0. SHA256 antes/después de8 archivos operativos, sin publicar huellas, confirma que ledger v3 failed18, scope, manifiesto, revisión, resultado y demás evidencias no cambiaron. Sin locks/tmp; no se creó ledger v4 real o cargó s00.env/.env.local.

Revisión de seguridad/compatibilidad: rutas construidas desde UUID validado, fuente auditada exacta, estados y resultados durables coherentes, errores de disco propagados como código fijo, datos proyectados mediante enums/rutas fijas y consumidores legacy bloqueados tras una futura v4. Se corrigieron dos errores TS de inferencia durante desarrollo y se protegieron casos de resultado duradero inconsistente/preview sin fuente; suites finales correctas. No se ejecutaron build/Next typegen, DB, lint (sin script) o APIs reales: este incremento modifica CLI/artefactos y evita autoload de credenciales. [Evidencia general](../verification.md).

Uso actual sin env-file: `--phase B_DIAGNOSTIC` para status y `--check-b-diagnostic` para validar bindings locales. El futuro execute requiere fase B_DIAGNOSTIC/new2/total20/included/reviewed y autorización humana posterior. Este desarrollo no utiliza el permiso B25 para realizar lecturas después del terminal. Incluso tras completarse el diagnóstico, la campaña/B quedan sin cambios y la causa histórica no se declara probada automáticamente. BD-T04, B-T04 y S00 operativos siguen pendientes.

## BD-T04: diagnóstico real autorizado — 29/10/2026

El usuario reiteró la autorización: credenciales guardadas, conservar18, hasta2 nuevas/máximo20 acumuladas, sin costos adicionales o modificaciones. API incluida respaldada por Hyper Growth y renovación06/11/2026 ya documentados; no se cambió plan ni compró cupo. Preflight offline `--check-b-diagnostic`: sourceCalls18/apiCalls0/bindingsValid=true. Suite BD reejecutada:28/28 correctas. Sin cambios de código.

CLI ejecutada una vez con phase=B_DIAGNOSTIC/execute/new2/total20/included/reviewed, carga interna de s00.env y sin cargar .env.local. Resultado completed: un GET propio, sin retry, **18 históricas +1 nueva =19 acumuladas**. Ledger v4 conserva snapshot v3 failed18 y antecedentes11/4; misma configuración/manifiesto/scope y sourceHash validado. Solo proyección fija, sin cuerpo remoto, claves, IDs o valores personales publicados.

| Observación actual                       | Resultado                                             |
| ---------------------------------------- | ----------------------------------------------------- |
| ID, nombre y workspace                   | Coinciden con el ensayo propio.                       |
| Estado                                   | Pausado confirmado.                                   |
| Listas de remitentes/tags/CC/BCC/routing | Vacías, coinciden.                                    |
| `ai_sdr_id`                              | Ausente; B exige null explícito.                      |
| `is_evergreen`                           | Ausente; B exige false explícito.                     |
| `stop_for_company`                       | Ausente; B exige false explícito.                     |
| `stop_on_reply`, schedule y sequences    | Coinciden; sequences vacío, schedule sin diferencias. |

Estas tres omisiones explican el rechazo actual de las guardas (`originalGuardPassesNow=false`). No prueban qué campo provocó el fallo histórico: la respuesta initial no se conservó (`historicalFailureCauseProven=false`). No interpretar ausente como false/null ni garantía de seguridad. B continúa failed, con cero leads registrados y sin reanudarse. Cero envíos, mutaciones, compras o verificaciones pagas por el ejecutor; facturación global no medida. No se gastó el segundo intento en una comprobación redundante.

BD-FR01–07/AC01–07 cubiertos en alcance combinado real/offline: identidad/pausa/continuidad/proyección reales, negativos mediante28 tests. Terminal completed no permite repetir para consumir saldo. BD-T04 completado; B-T04, C/D y S00 siguen abiertos. Siguiente incremento propuesto: revisar contrato oficial de opcionales y preparar compatibilidad/reconciliación offline del mismo recurso, conservando19; no relajar guardas o reiniciar con este permiso. Rollback conserva v4/historia, sin downgrade o devolución de peticiones.

Cierre local sin env/red: replay de status completed19/previous18/new1, hash del journal antes/después idéntico, sin lock/tmp y sin B reanudada. Formato documental y git diff --check correctos. No hubo más solicitudes a proveedores tras el GET exitoso.
