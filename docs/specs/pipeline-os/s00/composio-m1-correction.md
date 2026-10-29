# S00-C: reconexión del Gmail correcto de M1

Fecha: 26 de octubre de 2026, America/Bogota. Nivel **STRICT**, con spec-driven-development y automation-engineer. Estado actual: implementación/QA y prueba real C-T04/C-T05 completados con autorización16 nuevas/97 acumuladas. **M1 original recuperado, M2 correcto,11 nuevas/92 acumuladas, binding pausado y cierre completo.** El contrato y su historial de planificación se conservan debajo; no autorizan ejecuciones adicionales. [Uso implementado](composio-correction-runner.md), [evidencia final](../verification.md).

Complementa [spec](../spec.md), [diseño](../design.md), [tareas](../tasks.md), [verificación](../verification.md), [S00-B](composio-reconnect.md) y [diagnóstico](composio-identity-diagnostic.md). Los antecedentes y sus resultados se conservan.

## CR-S00-C01: motivo y cambio propuesto

La consulta diagnóstica autorizada confirmó que el candidato del segundo enlace pertenece a M2. Estado local comprobado sin env/API: recovery_required, identityDiagnostic=M2, sin binding, fuente intacta, una revocación y dos enlaces. El acumulado es **81**: histórico60 más S00-B21 (N15/R2/H4). M1 original figura REVOKED en su última lectura; no se asume que ese estado siga vigente sin comprobarlo al ejecutar.

El techo vigente88 deja siete peticiones, pero el recorrido completo propuesto necesita al menos once. No se repone H4, no se reutiliza el enlace que conectó M2 ni se reinicia el ledger. Se propone una extensión explícita y versionada: **11–13 peticiones normales, hasta3 reintentos de lectura, máximo16 nuevas/97 acumuladas**, con **un solo enlace nuevo**. Sería el tercero histórico, específicamente autorizado para esta corrección; no se habilita un cuarto enlace.

La autorización de lectura diagnóstica terminó. Crear el enlace y ejecutar esta extensión requieren autorización del protocolo concreto y del techo97, después de implementación/QA offline. Preparar este documento no acredita ni concede esa autorización.

## Objetivo, alcance y límites

Recuperar acceso al mismo Gmail M1 original y su hilo de prueba, verificar M2 original y conservar un binding lógico pausado con el nuevo ID de transporte. Primero confirmar offline el Gmail que el operador pretende conectar, luego OAuth humano y verificación efectiva por API. Un user_id compartido o pantalla de éxito Google no acreditan identidad.

Se reutilizan HTTP v3.1, Auth Config propia, perfiles, hashes, parsing metadata, persistencia y locks existentes. Sin SDK o dependencias nuevas, cambios Next/CRM/worker/Supabase, migraciones, despliegues, envíos, SMS, IA, cuerpos de mensajes, PDFs, cambios de scopes, pagos, upgrade de plan o herramientas Instant. No se revoca de nuevo M1 ni se modifica/revoca/elimina M2 original o la conexión equivocada. Una posible limpieza de duplicados queda fuera de alcance.

No se edita s00.env/.env.local ni se reescriben fingerprints históricos. El nuevo binding se registra solo después de los controles, operativamente pausado. La integración de conexión/reconexión en CRM sigue en S02.

## Requisitos

| ID     | Requisito y regla verificable                                                                                                                                                                   | Aceptación |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| C-FR01 | Antes de cualquier API, validar fuente81, diagnóstico M2, ausencia de binding, configuración original y autorización de la extensión97. Preservar todos los contadores/traces anteriores.       | C-AC01/02  |
| C-FR02 | Comprobar offline la dirección que el operador identifica como M1 contra la huella original. Si corresponde a M2 u otra dirección, bloquear antes de generar enlace.                            | C-AC03     |
| C-FR03 | Generar un único enlace con alias nuevo para el propietario/Auth Config originales; entregarlo por texto privado cuando el operador esté preparado. OAuth solo humano, sin contraseñas en chat. | C-AC04/05  |
| C-FR04 | Exigir candidate ACTIVE, owner/Auth Config/toolkit correctos y emailAddress válido cuya huella sea la de M1 y diferente de M2. Identidad inválida/equivocada nunca pasa por éxito.              | C-AC06     |
| C-FR05 | Validar histórico/relectura del hilo M1 y controles M2; aceptar binding pausado sin iniciar envíos ni cambiar configuración.                                                                    | C-AC07/08  |
| C-FR06 | Reservar cada petición antes de HTTP, aplicar N≤13/R≤3/total≤16 y base81/techo97. Sin retry de POST, máximo un retry por lectura recuperable, sin nueva alta automática.                        | C-AC09/10  |
| C-FR07 | Separar identidad recuperada, cierre de uso y resultado parcial; reporte sin correos, IDs privados, URL OAuth, cuerpos o tokens.                                                                | C-AC11/12  |

No funcionales: timeout de8s por HTTP; payloads acotados con helpers actuales; JSON estricto, persistencia atómica y locks antes de red; selección por connected_account_id exacto; autenticación solo backend. No se certifica SLA de producción ni cuota mensual disponible con una muestra de prueba.

## Flujo del operador

1. **Identificar M1 antes del enlace.** En el correo destinatario de prueba, abrir el hilo cuyo asunto termina en -M1 y comprobar el remitente. No usar el destinatario de prueba como M1 ni la cuenta seleccionada automáticamente por el navegador.
2. En la futura implementación se preparará un archivo privado/ignorado `.local/pipeline-os/s00-m1-target-email.txt`. El operador escribirá ahí, en una sola línea, la dirección del remitente de M1. Carga interna limitada a512 bytes; trim/lowercase y validación email antes de SHA-256. El programa emitirá solo coincide_M1/coincide_M2/no_coincide, sin imprimir o copiar esa dirección a reportes. No se pide pegarla en el chat. Archivo ausente/inválido/no coincidente bloquea sin API. En esta planificación no se crea ni se lee ese archivo.
3. Confirmar que el operador está disponible y que el mecanismo de entrega funciona con un archivo de texto sintético, antes de crear el enlace real. Usar una ventana de navegador separada, preferiblemente incógnito, para reducir la selección automática de M2. Esto ayuda a seleccionar; la prueba de identidad definitiva será profile.
4. Tras autorización de ejecución y preflight correcto, crear el enlace. **Aquí el agente avisará «Ahora selecciona el correo M1 en Google».** Entregar la URL HTTPS en un archivo privado de texto, como el método que funcionó en el diagnóstico previo. No copiar la URL a documentación/logs/chat ni navegar/autenticar automáticamente por el operador.
5. El operador copiará la URL en esa ventana, elegirá explícitamente el correo confirmado en el paso2 y comprobará la dirección que muestra Google antes de aceptar. Si aparece M2, usará el selector/otra cuenta, sin continuar el consentimiento de M2. No se manipulan scopes o credenciales OAuth.
6. El operador confirmará que completó el consentimiento. No habrá polling API mientras inicia sesión. Solo entonces se ejecutarán hasta tres lecturas de estado, perfil, histórico/relectura y M2/uso finales. Si Google devuelve un error, preservar journal y solicitar el estado visible sin contraseñas/códigos.

El plazo real del enlace lo determina expires_at. Requerir al menos3min útiles antes de entregarlo; comprobar TTL offline. Si vence, no generar otro dentro de esta extensión. No se promete que incógnito fuerce un selector concreto ni se inyectan prompt/login_hint no documentados en el REST link.

## Contrato API y evidencia de fuentes

Revisadas fuentes primarias el26 de octubre:

- [POST link v3.1](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink): auth_config_id y user_id, alias único; HTTP201 con redirect_url, connected_account_id y expires_at. Reusar el body REST ya probado, sin callback nuevo, SDK o flags no acreditados.
- [Ciclo de connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts): selección explícita por ID y credenciales enmascaradas; refresh está deprecado y no valida identidad. No extraer ni reutilizar tokens del GET. Si apareciera verifier pendiente, parar y replanificar.
- [Precios y límites](https://composio.dev/pricing): Hobby incluye llamadas de herramientas de app propia y detiene uso al límite; Instant tiene cobro separado. Esto no confirma saldo del proyecto. Mantener únicamente app OAuth propia/operaciones estándar, sin upgrades o Instant; error de cuota bloquea, no cambia el plan. usageBefore/After instantCharge no equivalen a auditoría completa de cargos o saldo mensual.

Rutas permitidas, todas usando la clave guardada solo cuando la ejecución esté autorizada:

| Fase                | Ruta/acción                                                    | Selección y validación                                                                             |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Preflight           | POST project/usage/summary con body vacío                      | Consulta de uso, no compra; conservar indicador limitado.                                          |
| Preflight           | GET auth_configs/{config_original}                             | Gmail, enabled, app propia, scopes de lectura requeridos; sin cambiar configuración.               |
| Preflight           | GET connected_accounts/{M1_original}                           | Identidad original y estado REVOKED; si cambió, detener antes de crear enlace.                     |
| Preflight/cierre    | POST tools/execute/proxy con método interno GET profile        | ID M2 original exacto; email válido y misma huella original.                                       |
| Enlace              | POST connected_accounts/link                                   | Un alias nuevo C-M1, mismo owner/Auth Config; HTTP201.                                             |
| Tras consentimiento | GET connected_accounts/{candidate_C}                           | Solo ID devuelto por ese enlace, distinto de IDs anteriores; máximo3 lecturas.                     |
| Tras ACTIVE         | Proxy GET Gmail profile                                        | Validar emailAddress antes de comparar huella M1; no equivale a user_id.                           |
| Histórico           | Proxy GET threads/{hilo_M1}, format=metadata y fields actuales | Dos lecturas, sin bodies/snippets/adjuntos; validar mismo hilo, participantes y mensajes baseline. |
| Cierre              | POST project/usage/summary con body vacío                      | usageAfter separado de binding verificado; informar cualquier falta de evidencia.                  |

Sin PATCH/DELETE/revoke/refresh ni rutas arbitrarias. Si POST link queda incierto, no se reintenta: una conciliación de lectura dentro de R puede buscar el alias exacto con los filtros originales y límite20. No continuar con página incompleta/ambigua o URL perdida; no reconstruir link_token. La excepción diagnóstica anterior no se vuelve a ejecutar.

## Presupuesto comprobable

Cada petición HTTP del ejecutor cuenta una vez, incluso errores. El consentimiento humano utiliza su flujo de navegador y no es una petición del ejecutor. No hay llamadas ocultas de SDK o validación pagada.

| Operación                                                      | Peticiones normales |
| -------------------------------------------------------------- | ------------------: |
| Uso inicial, Auth Config, GET M1 original, profile M2 original |                   4 |
| Crear un enlace nuevo                                          |                   1 |
| Estado del candidato tras confirmación humana, a0/15/30s       |                 1–3 |
| Perfil del candidato                                           |                   1 |
| Histórico M1 y relectura                                       |                   2 |
| Perfil M2 final                                                |                   1 |
| Uso final                                                      |                   1 |
| **Normal N**                                                   |           **11–13** |
| **Reserva global R: lecturas recuperables/conciliación**       |          **hasta3** |
| **Máximo adicional propuesto**                                 |              **16** |

Base81; mínimo92, normal máximo94, techo propuesto**97**. No sumar otra vez los siete slots sin consumir del techo88. Es un techo acumulado nuevo, no81+7+16. Ejemplos: N11/R0→92; N13/R0→94; N13/R3→97. Todos los contadores históricos N15/R2/H4 quedan congelados; los nuevos N/R son de C y se presentan separados.

Antes de link, asegurar saldo para sus1 + máximo restante8 normales y R aún no consumida. Retry de lectura: solo red/429/5xx, máximo uno por operación y tres globales, backoff≥5s/Retry-After. Si requiere espera>60s, parar. 401/403/422, identidad y validación no se reintentan. No retry automático de POST. Máximo tres status tras consentimiento, sin polling continuo; si no llega ACTIVE, recuperación pendiente. Guardar slots de perfil/cierre; no consumirlos en diagnósticos adicionales. Si se agota el techo, ningún HTTP extra para terminar el reporte.

## C-ADR01: extensión del mismo registro, sin reiniciar historia

El código actual fija versión1, máximo dos enlaces y techo88; no permite ejecutar este plan con flags nuevos solamente. Extender el ejecutor y loader por migración local explícita/versionada, opt-in y protegida por locks. Propuesta v2: conservar el snapshot v1 validado como predecessor inmutable, su huella y cómputo81; añadir bloque correction con autorización97, N/R, traces, fase, un enlace y proofs nuevos. Recalcular sourceHash contra fuentes anteriores; no usar un81 escrito a mano como presupuesto independiente. El total mostrado será81+correction.calls. El esquema v1 y su autorización histórica siguen verificables, con su1 revoke/dos links/N15/R2/H4 sin reescritura.

Mantener un único archivo autoritativo `.local/pipeline-os/s00-composio-reconnect.json`; migración atómica al mismo path tras guardar/validar el predecessor dentro del nuevo formato. Sin borrar/renombrar el journal para evadir límites, otro ledger que ignore el anterior o reponer R/H antiguos. El status deberá leer v1/v2 offline, sin env, OAuth o red; acciones antiguas no podrán seguir escribiendo tras la extensión. Locks ordenados run→observation→reconnect; reservas IN_FLIGHT antes de HTTP, sin POST duplicado al reiniciar. Source run/observation no se modifican.

La verificación usa el snapshot baseline de M1 conservado antes de la revocación y fuentes de pruebas37/60, no el candidato M2. Requerir todos los mensajes baseline y la respuesta observada S00-A. Si aparecen mensajes nuevos legítimos, conservarlos: validar identidad/thread/participantes, distinguir additions de pérdidas y exigir dos lecturas consecutivas con el mismo conjunto final. Pérdida de baseline, bodies o cambios entre ambas lecturas dejan cierre pendiente; no enviar mensajes para estabilizar el conjunto. Esta variante de baseline por subconjunto deberá probarse explícitamente; no modificar el criterio estricto de S00-B en silencio.

No se adopta reauth legacy sobre el candidato M2, porque su identidad está confirmada como M2. No se elimina/revoca esa cuenta para hacer sitio. Un tercer enlace nuevo con lineage explícita y perfil M1 es la corrección propuesta; no valida por sí solo la reconexión en el CRM.

## Aceptación y pruebas requeridas

| AC     | Dado / cuando / entonces                                                                                                                        | Evidencia requerida                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| C-AC01 | Dado snapshot81 válido, cuando se prepara C, entonces su contenido y counters quedan inmutables y total=81+C.calls.                             | Migración v1/v2, fuente o predecessor alterados, total falso y replay.                                 |
| C-AC02 | Dado techo88 o falta de aprobación C, cuando se intenta ejecutar, entonces cero HTTP/enlaces.                                                   | Gates positivos/negativos; status offline sin env.                                                     |
| C-AC03 | Dada dirección esperada local ausente/M2/otra/inválida, cuando se prepara link, entonces bloquear sin API y sin imprimirla.                     | Inputs sintéticos, límite512 bytes, sentinelas de privacidad.                                          |
| C-AC04 | Dado operador listo y preflight correcto, cuando se crea link, entonces un solo POST y entrega privada con TTL útil.                            | 201, fallos/timeout/crash, TTL, copia texto sintética y no URL en reporte.                             |
| C-AC05 | Dado enlace entregado, mientras el operador no confirma OAuth, entonces cero status polling.                                                    | Reloj/fetch inyectados y gate humano.                                                                  |
| C-AC06 | Dado candidate ACTIVE, cuando perfil es M2/otro/incompleto o owner/config incorrectos, entonces no binding, no alto adicional ni cambios en M2. | Perfiles M1/M2/OTHER/INVALID y payload vacío, IDs ajenos rechazados.                                   |
| C-AC07 | Dado perfil M1, cuando se leen hilo/relectura, entonces baseline incluido y conjunto final estable, con nuevos mensajes legítimos preservados.  | Baseline perdido, nuevos mensajes, relectura inestable, hilo equivocado, body y attachment rechazados. |
| C-AC08 | Dado perfil/histórico correctos y M2 final correcto, entonces binding M1 pausado; ninguna ruta de envío/worker/env ejecutada.                   | Dos perfiles bajo mismo user_id, M2/control fallido, estado final y replay.                            |
| C-AC09 | Dado N13/R3 y base81, cuando se agota presupuesto, entonces≤16 nuevas/97 acumuladas, sin17ª/98ª HTTP.                                           | Casos11,13,16; slot reservado antes de red, uso final fallido.                                         |
| C-AC10 | Dado timeout/IN_FLIGHT de link, cuando se reanuda, entonces conciliación explícita sin repetir POST o cuarto enlace.                            | Crash/disco, locks y página/alias ambiguos o URL perdida.                                              |
| C-AC11 | Dado binding verificado sin usageAfter, entonces distinguir identidad recuperada de cierre completo.                                            | Error de uso final y reporte parcial sin reactivar nada.                                               |
| C-AC12 | Dado el reporte/journal, entonces reporte público sin emails/IDs/URLs/tokens y fuentes preservadas.                                             | Scan de sentinelas, JSON estricto, status/replay sin HTTP/escrituras.                                  |

## Tareas y gates de ejecución

| ID    | Objetivo y FR                                              | Dependencias                                                                                                          | Terminado / pruebas                                                                                                                                                               |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-T01 | Protocolo y cambio de límites C-FR01–07.                   | Diagnóstico M2/base81.                                                                                                | Requisitos/AC/rutas/cuentas/budget/rollout trazados; revisión documental. Preparado.                                                                                              |
| C-T02 | Extender loader/journal/CLI y precheck local C-FR01–03/06. | T01, autorización de implementación.                                                                                  | v1/v2 sin reset; nueva acción opt-in, input M1, entrega texto, mutación única; tests AC01–05/09/10/12. Completado offline,173/173 S00.                                            |
| C-T03 | Implementar verificación/cierre y QA offline C-FR04–07.    | T02.                                                                                                                  | AC06–12 positivos/negativos; siete suites S00 + typecheck/formato/revisión; fetch ambiental bloqueado y cero API reales. Completado offline, TypeScript correcto.                 |
| C-T04 | Ejecución real por fases.                                  | T03, operador/input M1/cuota preparados y autorización explícita único nuevo link/máximo16 adicionales/97 acumuladas. | Preflight, link, aviso al usuario, OAuth humano, perfil M1/histórico/M2; counters sin superar techo. Completado con11 nuevas/92 acumuladas.                                       |
| C-T05 | Consolidación y entrega.                                   | T04 o fallo documentado.                                                                                              | Evidencia sanitizada y estado de recuperación/cierre, locks liberados, replay offline; S00 no se declara completo por esta prueba. Completado, replay offline0 HTTP/0 escrituras. |

Actualización: C-T02/C-T03 completados en el alcance offline.27 pruebas nuevas C y173/173 S00, TypeScript correctos; matriz de aceptación local y limitaciones en [verification](../verification.md). C-T04 real y C-T05 operativo siguen pendientes. No se migró el ledger real ni se generó un enlace; se preparó solo la plantilla vacía de dirección esperada.

Actualización operativa posterior: el usuario autorizó16 nuevas/97 acumuladas, precheck M1 correcto y consentimiento humano completado. C-T04/C-T05 terminados: candidato ACTIVE/perfil M1, histórico y relectura, M2 original antes/después y uso final correctos.11 nuevas/92 acumuladas, N11/R0; un enlace C y binding pausado, sin envíos/descargas o cambios en env. Replay offline HTTP0/escrituras0, fuentes preservadas y locks liberados. El saldo autorizado restante no se consume automáticamente. S00 general y activación en CRM no se cierran por este resultado.

## Rollout, compensación y riesgos

Rollout local y manual: implementar/QA sin red → confirmar dirección/operador → autorizarC97 → preflight/link → avisar para selección Google → verificación/cierre. No despliegue o producción. El aviso para Google solo se dará al existir un enlace nuevo válido y entrega lista, no ahora.

Rollback de código antes de ejecutar: retirar extensión no utilizada, preservando cambios ajenos. Después de persistir v2, ningún downgrade puede truncar traces o reabrir presupuesto; conservar lector compatible o detener para revisión. Si identidad final es M2/otra, no aceptar binding ni revocar/borrar automáticamente: documentar recuperación pendiente y preparar otro alcance. Tokens revocados no se pueden restaurar. El original M1 ya está revocado; esta prueba no agrega otro corte. Si OAuth expira/falla o no cabe reserva, detener sin segundo enlace C. Si faltan controles finales, reportar resultado parcial.

Cambios de base de datos y migraciones remotas: no aplican. Nuevas tecnologías/servicios/despliegues: no aplican. Verificación real, SLA productivo y costos globales: no acreditados por la planificación.
