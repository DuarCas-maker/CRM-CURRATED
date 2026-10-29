# INS-A: ejecutor de lectura — implementación STRICT

2026-10-26. Alcance autorizado: implementar y probar offline. Cero API real, carga de credenciales, envíos o recursos remotos. Complementa [protocolo INS](instantly-validation.md), INS-FR01/02/07/08 e INS-AC01/02/03/11/12/13/14. No implementa B, C ni D; INS-T02 se divide para no atribuirles una implementación inexistente.

## Contrato y decisiones

Disparador manual CLI. `status` por defecto: solo journal opcional, sin env, mkdir, HTTP o escrituras. `check-config`: valida presencia/forma mediante entorno inyectado, cero HTTP/escrituras; no afirma autenticación. Ejecución futura exige `--execute --phase A --authorized-new 12 --included-calls-confirmed`; esos flags registran alcance, no sustituyen autorización humana. No dotenv ni autoload. En esta entrega solo fixtures ficticios.

Transporte propio GET a seis rutas exactas de `https://api.instantly.ai/api/v2/`: workspaces/current, workspace-billing/plan-details, api-keys, accounts, webhooks/event-types y campaigns. Query tipada y construida internamente, limit=100, cursor codificado y búsqueda por nonce aleatorio fijo. Nunca acepta URL arbitraria. Sin SDK/dependencias nuevas; reutiliza hash/error/Retry-After de primitivas S00. No cambia los ejecutores conjuntos ni la aplicación.

Contrato revisado en documentación pública oficial: [workspace](https://developer.instantly.ai/api-reference/workspace/get-workspace), [plan](https://developer.instantly.ai/api-reference/workspacebilling/get-workspace-plan-details), [keys](https://developer.instantly.ai/api-reference/apikey/list-api-key), [accounts](https://developer.instantly.ai/api-reference/account/list-account), [events](https://developer.instantly.ai/api-reference/webhook/list-available-event-types) y [campaigns](https://developer.instantly.ai/api-reference/campaign/list-campaign). Se usan id de workspace; organization_id de plan/key y organization de account/campaign; subscriptions.outreach.total_lead_limit/current_lead_count; listas items/next_starting_after; event_types con id. Ejemplos de fixture reproducen esa estructura con identificadores y datos ficticios, sin copiar claves publicadas.

Orden y presupuesto: workspace1 → plan1 → keys1–3 → accounts1–2 → events1 → campaigns1–2. N≤10, R≤2, total≤12; un retry máximo por página, solo red/timeout/429/5xx. Cada intento se reserva durablemente antes del HTTP, incluso fallos. Separación mínima 1s; backoff mínimo5s/Retry-After; espera requerida>60s detiene. Timeout8s y respuesta JSON≤2MiB. Redirecciones bloqueadas y cuerpos/errores del proveedor descartados. 401/402/403 no se reintentan. Excepción:403 de keys es diagnóstico opcional, permite continuar con scopes desconocidos.

Identidad de workspace exacta antes de otras consultas; campos de organización presentes deben coincidir y los registros necesarios para atribuir scopes/cuentas/campañas deben acreditarla. Scopes solo de coincidencia exacta de clave actual en memoria; flags de lista permitida, nunca nombres arbitrarios de scopes. Un200 no prueba escritura. Keys enmascaradas/no encontradas/paginación agotada → desconocido y bloqueos posteriores explícitos. Accounts/campaigns incompletos detienen; cursos repetidos, registros duplicados/esquema inválido fallan cerrado. No interpretar códigos desconocidos de account como activos. Campañas: solo ausencia exacta del nombre del nonce en búsqueda completa; ninguna se adopta como propia ni se modifica.

ADR INS-A03: no se reanuda automáticamente una ejecución interrumpida. Journal existente completed/failed/running se reporta sin nuevas llamadas; IN_FLIGHT cuenta consumido y requiere revisión explícita. Evita que reinicios gasten la reserva o vuelvan a consultar sin conciliación aprobada. Ningún reset/force/nuevo run por CLI. Cambios de clave/workspace o manifiesto bloquean execute. El informe no autoriza B/C, ni declara capacidad de envío, cuotas de email o facturación verificadas.

Journal privado ignorado `.local/pipeline-os/s00-instantly-run.json`, versión1, faseA, nonce, huella de configuración/manifiesto, N/R, trace de operaciones/resultados sin rutas/cursors/PII, y resúmenes mínimos. Esquemas Zod estrictos y validación cruzada de contadores/orden. Archivo con tamaño limitado, lock exclusivo, temporal wx, sync+rename; historial monotónico, sin borrar locks/temporales ajenos. Fallos de persistencia detienen antes de la siguiente llamada. Reporte reconstruido mediante proyección permitida: no key/hash/UUID/email/cursor/nombre/cuerpo/error arbitrario. Los hashes no son una defensa contra edición maliciosa local; no borrar el journal para reiniciar consumo.

Seguridad → prueba: SSRF/mutación → rutas/métodos/query estrictos; tenant distinto → parada tras identidad; scopes ajenos → desconocido; cuota/crash → reserva durable y replay sin HTTP; secretos/PII → sentinelas; competencia → lock y historial; límites/timeout → stream/backoff/cancelación. No DB/migración/UI/deploy en este alcance. Rollback local: retirar estos módulos y conservar cualquier journal; no efectos remotos que compensar. Red real pendiente y deberá contrastar schemas/permiso/plan sin relajar validaciones en silencio.

## Aceptación y tareas del incremento

| ID     | Dado / cuando / entonces                                                         | Evidencia offline necesaria                                            |
| ------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A-AC01 | Sin execute, status y check-config no llaman red ni escriben; status no lee env. | Proxies/trampas y subprocess CLI en carpeta temporal.                  |
| A-AC02 | Sin autorización exacta A12/included, o configuración inválida, cero HTTP.       | Ausencias, B/C, presupuesto distinto, clave insegura, UUID incorrecto. |
| A-AC03 | Workspace/organización ajenos impiden atribuir datos/permisos.                   | Workspace, plan y registros cruzados.                                  |
| A-AC04 | Scopes solo de clave actual; desconocido si enmascarada/403/no encontrada.       | Clave en página2/3 y clave distinta con all:all.                       |
| A-AC05 | Paginación completa o bloqueo explícito, sin duplicados/ciclos.                  | Límites3/2/2, cursores con &, repetidos y filas inválidas.             |
| A-AC06 | Solo GET allowlisted, sin redirect, cuerpos JSON acotados y timeout/cancelación. | Rutas/queries/métodos adversarios y respuestas inválidas/lentas.       |
| A-AC07 | Reservar antes de HTTP, N≤10/R≤2/total≤12; retry solo recuperables una vez.      | Máximo12,401/402/403,429/5xx/red/Retry-After, fallo del store.         |
| A-AC08 | Replay/interrupción/cambio de binding no reinicia consumo.                       | completed/failed/IN_FLIGHT, fingerprint y manifiesto distintos.        |
| A-AC09 | Journal validado, lock y escritura atómica preservan historial.                  | Disco/lock/tmp/JSON corrupto/reset/downgrade.                          |
| A-AC10 | Reporte minimizado y límites de evidencia explícitos, sin verde de B/C/D.        | Sentinelas en errores/campos, scopes desconocidos, campaña encontrada. |

| Tarea      | Objetivo / requisitos                           | Dependencia | Estado                                                              |
| ---------- | ----------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| INS-T02-A1 | Núcleo, schemas y transporte A-AC01–08/10       | INS-T01     | Completado offline; suite INS.                                      |
| INS-T02-A2 | Files/CLI A-AC01/02/08/09                       | A1          | Completado offline; CLI con transporte simulado y journal temporal. |
| INS-T02-A3 | Fixtures, tests, typecheck y revisión A-AC01–10 | A1/A2       | Completado: 30 pruebas INS y 203/203 S00; TypeScript correcto.      |

INS-T02 de B/C permanece pendiente. INS-T04 (ejecución real A) requiere QA anterior y autorización; no se ejecuta en esta entrega.

## Uso y evidencia del incremento

Desde la raíz, `node --import tsx scripts/pipeline-os/s00-instantly-runner-cli.ts` muestra status offline. `--check-config` inspecciona solo variables ya cargadas por el proceso; no abre archivos de entorno. No es necesario cargar claves para status o tests. La CLI no tiene reset/force ni operaciones B/C. El comando de ejecución y la carga interna de credenciales solo se utilizarán tras autorización de las 12 peticiones A y confirmación del cupo incluido; no se ejecutaron en este incremento.

Código: [núcleo](../../../../scripts/pipeline-os/s00-instantly-runner.ts), [files](../../../../scripts/pipeline-os/s00-instantly-files.ts), [CLI](../../../../scripts/pipeline-os/s00-instantly-runner-cli.ts), [pruebas](../../../../tests/pipeline-os-s00-instantly-runner.test.ts). La suite contiene fixtures con la estructura documentada y valores ficticios, fetch real bloqueado y relojes inyectados. El recorrido subprocess de la CLI instala un transporte simulado antes de importar el ejecutor; produce seis GET ficticios y journal en una carpeta temporal exclusiva. Status y execute repetidos no añaden HTTP ni cambian ese journal. No crea el journal operativo del proyecto.

Trazabilidad: A-AC01/02 → modos/gates/subprocess; A-AC03/04 → tenant/clave exacta/403/scopes desconocidos; A-AC05 → 3/2/2 páginas, cursores y duplicados; A-AC06/07 → allowlist, 2MiB, timeout8s con reloj simulado, cancelación, N10/R2 y máximo12; A-AC08/09 → binding/manifiesto, replay, fail-at-save, lock/tmp/atomicidad; A-AC10 → sentinelas, tipos/capacidad desconocidos y nombre existente. [Resultados y límites](../verification.md).

Aceptación real pendiente: autenticación/permisos efectivos, schemas del workspace real, contacto disponible y catálogo de eventos. Los límites diarios configurados son inventario, no capacidad restante ni autorización de envío. Los slots calculados a partir de total/current son una lectura puntual, no una reserva para B. Una ejecución incompleta/IN_FLIGHT requiere revisión antes de definir recuperación y presupuesto; conservar journal y temporal, sin relanzar desde cero.

## Ensayo real A posterior: detenido con 4/12

Autorización A12 y plan Hyper Growth confirmados por el usuario/captura. Workspace y plan validados por API;83 posiciones de contacto en lectura. El procesamiento de página2 de keys detectó DUPLICATE_RECORD: journal failed/checkpoint2, cuatro intentos N y cero R. Los scopes actuales y las consultas restantes siguen sin acreditar. No se gastan los ocho intentos restantes mediante reset u otro script. Replay offline del journal real no hace HTTP/save y conserva hash; sin locks/temporales. [Evidencia y recuperación pendiente](../verification.md). El rechazo de duplicados permanece vigente; requiere protocolo de diagnóstico/continuación antes de nuevas consultas. Sin envío o fase B/C/D ejecutada.

Extensión posterior [INS-R implementada offline](instantly-pagination-recovery.md): continuidad explícita v2 solo desde esa base, snapshot histórico íntegro, misma huella/nonce y contador4→máximo12, una muestra de claves que nunca concede scopes desde duplicados y lecturas restantes.24 casos nuevos,227/227 S00 y TypeScript correctos. No se alteró/migró el journal real ni se llamó API; R-T04 real sigue pendiente. El modo original v1 conserva su fallo y no puede sobrescribir una futura versión2.

Recuperación real posteriormente autorizada: **7 nuevas/11 acumuladas**, completed con único bloqueo CURRENT_KEY_SCOPES_UNKNOWN. Inventarios de workspace/plan/cuentas/eventos/búsqueda completados y predecessor4 preservado íntegro, replay HTTP0/save0 sin cambios. R1 es paginación accounts, no retry. Las lecturas no acreditan mutaciones de B/C; queda confirmar scopes en panel. No gastar el último intento mediante reset o nuevo script. [Resultado real](../verification.md).

Confirmación posterior sin API: captura de CRM-curated con all:all y afirmación del usuario de que es la clave guardada. Constancia privada separada, vinculada a la última configuración probada y evidencia de panel. Satisface el método alternativo de acreditación documental de scopes para INS-T04; no cambia identified=false/scopes=null del ensayo API ni prueba escrituras. Antes de reutilizar la constancia, verificar que la huella actual coincide; no transferirla tras rotar claves. Journal original idéntico en11, sin ejecutar B/C o envíos. [Registro](../verification.md).
