# INS-R: recuperación acotada de paginación — SDD STRICT

2026-10-26. Modo implementación offline; skills SDD, automation-engineer y systematic-debugging, con revisión safe-code-review al entregar. Autorizado preparar/implementar/QA conservando cuatro peticiones, **sin HTTP real ni reiniciar el contador**. No cargar archivos de credenciales o migrar el journal operativo en esta entrega.

## Discovery, problema y cambio de contrato

Base: [ensayo A](instantly-phase-a.md), journal v1 failed/DUPLICATE_RECORD/checkpoint2, N4/R0, workspace/plan OK y dos páginas keys200. Solo se conservan metadatos; no cuerpos/IDs de claves. Causa del proveedor no demostrada: solapamiento entre páginas, duplicados dentro de página2 o cambios concurrentes siguen como hipótesis. No se inventa diagnóstico definitivo. [List API Key oficial](https://developer.instantly.ai/api-reference/apikey/list-api-key) acredita limit/starting_after/next_starting_after, nombres que usa el cliente. No hay base para deducir que cambiar el nombre del parámetro corrija el servidor.

El bloqueo del cliente sí está trazado: v1 trata duplicado de un inventario opcional de scopes como fallo de toda A y no ofrece continuación. Se reproduce con fixtures antes de ampliar el contrato. La recuperación conserva ese resultado en un predecessor inmutable; no cambia retrospectivamente la regla de duplicados de v1.

**INS-R-ADR01, excepción explícita a INS-A03:** nuevo modo recover-pagination, ejecutable solo con gate específico futuro, desde la base exacta v1 failed4 anterior. Snapshot canónico completo+hash en el mismo journal v2, nonce/fingerprint heredados y manifiesto de recuperación. No se admiten reset, otra base, cambiar clave/workspace, rehacer un run nuevo o volver a abrir un v2 terminal/interrumpido. Default/status y preview offline no migran/escriben ni consultan env. V1 execute tampoco puede eludir un v2.

**INS-R-ADR02, diagnóstico único:** una consulta nueva keys limit100 sin starting_after; no se vuelve a perseguir cursor de keys. Examinar schema/tenant, unicidad por ID y coincidencia exacta de la clave en memoria; diagnóstico solo contadores/flags. Duplicados idénticos o conflictivos dentro de la muestra **nunca conceden scopes**. Se distingue repetición/conflicto sin persistir valores. Un único match en muestra válida no duplicada permite flags declarados de esa clave, sin afirmar permisos efectivos; masked/notfound/cursor presente/scopes faltantes/403 quedan desconocidos explícitos. Schema/tenant inválido para atribución detiene; la opcionalidad no encubre datos de otro workspace. El fallo histórico no se considera causa resuelta por recibir una muestra limpia.

Al concluir las lecturas restantes se distingue `completed` del informe de capacidades: scopes desconocidos y anomalía histórica conservan bloqueos; no autoriza B/C/D ni envío. Esto recupera el inventario de lectura sin convertir una ambigüedad en aprobación de permisos.

## Requisitos, seguridad y aceptación

| FR     | Objetivo                                                                                                             | AC verificable offline                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R-FR01 | Preservar base4, nonce, fingerprint, predecessor y techo12 en ledger único v2.                                       | R-AC01: solo base exacta elegible; snapshot alterado, reset/downgrade o transición terminal rechazados.             |
| R-FR02 | Modos default/preview sin env, HTTP, mkdir o save; ejecución futura con A/new8/total12/included y recover explícito. | R-AC02: traps/CLI; flags ausentes/contradictorios, otra fase/base/binding → cero HTTP/migración.                    |
| R-FR03 | Diagnóstico keys una vez, sin cursor/repetir paginación; permisos exactos o desconocidos.                            | R-AC03: duplicates/conflictos/mascaradas/coincidencia doble/403 no atribuyen scopes; tenant/schema ajenos fallan.   |
| R-FR04 | Revalidar workspace/plan y completar accounts≤2/event-types/campaigns≤2 con nonce original.                          | R-AC04: identidad/plan, cursor codificado/repetido, duplicados e incompletos; no adoptar recursos ajenos.           |
| R-FR05 | Reservar antes de HTTP, mantener N≤10/R≤2/acumulado≤12; errores/timeouts/esperas limitados.                          | R-AC05: 6 nuevas mínimas,8 máximas, retries/páginas comparten R2; disco/timeout/429/budget fallan sin sobreconsumo. |
| R-FR06 | Proyección sin secretos/cursors/IDs; no operar B/C/envíos y no borrar evidencia por errores.                         | R-AC06: sentinelas, replay completado/fallido/IN_FLIGHT con HTTP0/save0; locks/temp y fuentes preservados.          |

Amenazas: SSRF/mutación → transporte GET/host/ruta/query existente; tenant drift → refresh antes de inventarios; privilegios de otra clave → match exacto; reinicios/carreras → wx+snapshot/transiciones/counter; filtraciones → vocabulario fijo y proyección; abuso de reserva → contador separado/purpose; inferencia falsa → flags unknown y anomalía histórica. No DB/migraciones/UI/deploy, dependencias o infraestructura nueva.

## Diseño y presupuesto futuro

Extender CLI/files existentes; módulo de recuperación que comparte transporte, validadores y transformaciones puras con v1, sin SDK o transporte alternativo. Estado v2 en `.local/pipeline-os/s00-instantly-run.json`, preserva predecessor v1 íntegro+hash, status/checkpoint nuevos, intento por op/página/bucket/purpose/result, counters acumulados y resultados minimizados. Plan/identidad previos son históricos: los refrescos se guardan aparte, sin modificar snapshot. Migración únicamente al ejecutar la recuperación autorizada; nunca por lectura/preview.

| Operación                                   | Normal nueva |                                        Reserva posible |
| ------------------------------------------- | -----------: | -----------------------------------------------------: |
| Refresh workspace + plan                    |            2 |                                      Retry recuperable |
| Una muestra keys                            |            1 | Retry recuperable de esa misma muestra, no otra página |
| Accounts primera página                     |            1 |                                   Segunda página/retry |
| Event types                                 |            1 |                                      Retry recuperable |
| Campaigns primera página por nonce original |            1 |                                   Segunda página/retry |
| Total                                       |        **6** |                                      **2 compartidas** |

**4 previas +6 normales =10 acumuladas; hasta2 de reserva =12. Máximo8 nuevas.** N global10/R global2 intactos. Aclaración de contrato: en esta recuperación R cubre tanto la continuación de páginas accounts/campaigns como reintentos de lectura; cada intento lleva purpose `first`, `page` o `retry`, sin transferencia de cuotas o reserva adicional. Si ambas listas necesitan segunda página, no queda R para retry; si se agota R, detener sin llamada de reporte/diagnóstico adicional. Keys es la tercera muestra normal contando dos históricas; un retry queda identificado en R. No se reinician doce peticiones.

Timeout8s/JSON2MiB, separación≥1s, backoff≥5s/Retry-After, espera>60s detiene, un retry máximo por página solo red/timeout/429/5xx. 401/402/403 y schemas inválidos no retry; keys403 es unknown explícito. No se reanuda automáticamente ningún v2 existente, aunque tenga saldo: reconstruir reporte y preservar gasto, revisar recuperación siguiente por separado.

## Tareas y rollout/rollback

| T     | Objetivo/requisitos                                          | Dependencia                                        | Terminado                                                                      |
| ----- | ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| R-T01 | Contrato/AC/ADR/presupuesto R-FR01–06                        | Discovery y snapshot real de metadatos             | Preparado.                                                                     |
| R-T02 | Núcleo v2+transformaciones/diagnóstico+files/CLI             | T01                                                | Completado offline; sin migrar base real.                                      |
| R-T03 | Fixtures+negativos, regresión S00/typecheck/formato/revisión | T02                                                | Completado:24 nuevas,227/227 S00 y TypeScript.                                 |
| R-T04 | Ejecución real preservando4 y techo12                        | T03 y habilitación explícita posterior del usuario | Completado tras autorización posterior:7 nuevas/11 total; scopes desconocidos. |

Rollout: contrato → fixture del fallo v1 → implementación/QA offline → preview del snapshot real sin env/save/HTTP → habilitación humana de ejecución posterior. La autorización previa A12 no prevalece sobre la instrucción actual de no llamar APIs. No pedir nuevas credenciales por este fallo de paginación.

Rollback: retirar extensión/CLI nueva conservando evidencia y cualquier v2 que exista tras una ejecución futura; un v1 antiguo no debe ignorar/sobrescribir v2. No degradar ledger a v1 para recuperar saldo. En esta entrega el journal operativo debe quedar idéntico byte a byte; comparar hash antes/después sin publicar secretos ni valores privados. HTTP real, contrato efectivo, scopes y cierre de A/T00-04/S00 permanecen pendientes.

## Ejecutor y evidencia offline

Código [recuperación](../../../../scripts/pipeline-os/s00-instantly-recovery.ts), con [núcleo compartido](../../../../scripts/pipeline-os/s00-instantly-runner.ts), [files](../../../../scripts/pipeline-os/s00-instantly-files.ts), [CLI](../../../../scripts/pipeline-os/s00-instantly-runner-cli.ts) y [suite R](../../../../tests/pipeline-os-s00-instantly-recovery.test.ts). Sin nueva dependencia o proceso externo. La consulta `node --import tsx scripts/pipeline-os/s00-instantly-runner-cli.ts --recover-pagination` es un preview offline: no usa env/mkdir/save/HTTP. Ejecución futura agrega `--execute --phase A --authorized-new 8 --authorized-total 12 --included-calls-confirmed`; no se invocó con credenciales reales en esta entrega y los flags no sustituyen habilitación humana.

Fixtures reproducen el fallo mediante el v1 real con transporte simulado, después prueban migración v2, diagnósticos negativos, rechazo de corrupción/binding/contador, reserva compartida, timeouts, privacidad y CLI con filesystem temporal.24 escenarios R correctos; nueve suites S00 **227/227**, TypeScript directo correcto. Preview del journal operativo real, con env/fetch/save prohibidos: elegible=true, versión1/failed4, HTTP0/save0, hash idéntico al inicio de este turno y tras preview, cero locks/temporales. [Evidencia completa](../verification.md).

La recuperación no puede reconstruir las dos páginas históricas ni demostrar causa raíz sin evidencia nueva. Su muestra única puede dejar scopes desconocidos; completado con esos bloqueos no es aceptación de B o integración productiva. R-AC01–06 cubiertos offline, aceptación real pendiente R-T04. No se cerró INS-T04/T00-04/S00.

## Ejecución real posterior autorizada

R-T04 completado con **7 nuevas y11 acumuladas**, N10/R1; R fue segunda página de accounts, cero retries. Snapshot original failed4 íntegro en v2, hash de bytes reconstruido igual al original. Ledger completed/checkpoint6; replay con configuración interna y fetch/save prohibidos da HTTP0/save0, sin cambios o locks. Workspace/plan83 posiciones,32 cuentas con inventario completo, reply_received/email_bounced/lead_unsubscribed disponibles y búsqueda por nonce completa sin coincidencias. Sin envío/importación/suscripción/pago o cambios de plan.

Muestra keys: dos IDs distintos y sin conflictos, cero match exacto de la clave guardada y cursor abierto. Scopes siguen desconocidos; historicalPaginationAnomaly=true y root cause no acreditada. La CLI señala el bloqueo aun con status completed. Queda1 del techo sin gastar y no se usa para otra consulta o reinicio. Próximo gate: evidencia de los permisos de la clave actual en panel, ligada a su identidad sin exponer el secreto; B/C/D y S00 abiertos. [Detalle y límites](../verification.md).

El gate documental se resolvió después mediante captura CRM-curated/all:all y confirmación explícita del usuario sobre la variable guardada. Constancia privada ligada a última huella probada y fuente de panel, sin cargar credenciales o hacer API. No modifica el ledger v2 ni sus resultados:11 y scopes desconocidos por API permanecen como historia. INS-T04 aceptado para descubrimiento y permisos declarados; B/C efectivos no probados/autorizados. [Confirmación registrada](../verification.md).
