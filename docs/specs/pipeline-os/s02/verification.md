# Evidencia de preparación S02-I01

## Resultado vigente: implementación local autorizada

31/10/2026. El usuario autorizó implementar/probar offline S02-I01, mantener Gmail directo activo, Composio deshabilitado en producto y43 Instantly, sin llamadas reales/envíos/cambios remotos. T03–06 completadas localmente. La sección de preparación inferior conserva su alcance histórico.

**Resultado:** ocho archivos de código/tests del manifiesto, un único existente modificado (google.ts);33/33 pruebas nuevas,0 fallos/omisiones/cancelaciones, TypeScript y formato correctos. [Huellas y alcance](implementation-manifest.json). S02 completo y la selección operativa de Composio siguen pendientes.

### Cobertura ejecutada

| AC | Evidencia del delta |
|---|---|
| AC01/10 | Fachada fija provider=gmail_oauth, variables ficticias Composio no la cambian; nuevos módulos sin env/DB/S00/UI; imports con red nativa bloqueada. |
| AC02 | HTTP directo conserva URL/options/headers/raw/JSON y errores Gmail con operación/Retry-After. OAuth/caché y secuencia hasta beforeRequest comparadas con el baseline, sin cambios. |
| AC03/06 | Ocho recursos proxy probados, conexión/propietario exactos, snapshot inmutable; IDs/config/binding/proyecto inválidos, rutas/métodos/headers/opciones ajenos y redirects rechazados. |
| AC04/05 | Fachada real invocada como función con OAuth/DB/fetch ficticios: OAuth→reserva→hook→wire; hook vetado, cuota diaria agotada o reserva inválida producen cero HTTP Gmail adicionales. Reserva conserva account/project/units. |
| AC07 | Outer401/403/429/422/500 no son GmailError ni cuota Google; razón Google interior separada. Errores redactados, sin cause o texto externo; Retry-After exterior no se atribuye al interior. |
| AC08 | Timeout/excepción, envelope truncado/incompleto y status ambiguo tras POST conservan incertidumbre, un solo intento y ningún fallback. Fetch o body que no cooperan con AbortSignal también se cancelan. |
| AC09 | IDs/cursor/hilo/firma y raw conservados; mutación del request externo no cambia su destino/correlación.20 MiB de adjunto entrante y18 MiB saliente con MIME/base64 caben; overflow por header/stream/cuerpo/envelope falla sin truncar. |
| AC10 |532 archivos públicos previos ajenos iguales,49 JSON privados de raíz idénticos,39 fuentes públicas S01 intactas, HEADfb9f201 y ninguna dependencia/DB/worker/UI/ensayo alterados. |

### Comandos y resultados

Runtime Node22.23.4 existente; sin instalación de dependencias o lectura de env reales. Se creó únicamente un preload QA ignorado que bloquea fetch real, HTTP/HTTPS, socket/TLS y DNS. Los tests usan fetch/servicios inyectados o mocks, nunca servidores o credenciales reales.

- `node --import ./.local/pipeline-os/s02-i01/offline.mjs --import tsx --test tests/pipeline-os-s02-transport.test.ts` → **33/33**, duración final aproximada2,4s. TAP privado ignorado; incluye subtests, no33 AC diferentes.
- `node --import ./.local/pipeline-os/s02-i01/offline.mjs node_modules/typescript/bin/tsc --noEmit --incremental false` → **correcto**, sin Next/typegen/env.
- Prettier `--write` únicamente sobre los ocho paths y posterior `--check` de esos mismos archivos → **correcto**.
- Comparador local de hashes/alcance/OAuth/hook, manifiesto S01 y journal raíz → **correcto**; no escribe registros operativos. git diff --check correcto.

El primer pase nuevo dio29/30: el test reprodujo coerción de undefined/número a texto en quotaProjectId. Se exigió string explícito y se repitió la suite afectada:30/30. El primer typecheck detectó anotación contextual genérica del adaptador directo y ampliación de tipo RequestRedirect en fixtures; se corrigieron solo archivos autorizados y pasó. La revisión añadió correlación de IDs, snapshot del request, validación UTF-8/tamaño, abort efectivo y límites MIME; tras esos cambios la batería ampliada quedó33/33 y TS/formato correctos. No se omitieron tests ni se relajó un criterio para pasar.

### Revisión y límites de entrega

Revisión propia con safe-code-review del diff/consumidores y prioridades de permisos, incertidumbre, SSRF, memoria/cancelación y compatibilidad. No quedan hallazgos confirmados pendientes dentro de I01 tras las correcciones anteriores. No es auditoría general ni aceptación de seguridad remota. El adaptador no consulta vigencia real, no decide permisos comerciales y exige contexto ya resuelto; S01 y el resolvedor/corte posteriores continúan siendo condiciones de activación.

No se ejecutaron pruebas manuales aceptadas, suites S00/S01 o regresiones generales ya aceptadas. Tampoco build/Next (sin cambios de rutas/UI/config), worker, servidor, PGlite/SQL de app, OAuth, API de proveedor, Bouncer, envíos, commit/push o despliegue. Las validaciones específicas del delta y TypeScript cubren esta extracción local; no se afirma compatibilidad actual del proveedor sin un futuro corte autorizado. No hay conexión real seleccionable por la app ni flag global para activarla.

Balance: **cero llamadas reales/cambios remotos; Instantly43 conservadas**, todos los49 JSON privados raíz idénticos y S01 sin modificaciones. La API key de Composio y sus bindings reales no se cargaron. Rollback de I01: revertir solo esta extracción/módulos autorizados conservando pendientes del usuario; no requiere SQL, reconexión o reactivación. Siguiente bloque: preparar integración coordinada de los contratos S01 necesarios y el binding por cuenta, sin habilitar Composio automáticamente.

## Antecedente: preparación y revisión S01

31/10/2026, America/Bogota · STRICT · Revisión previa a la autorización de implementación. [Spec](spec.md), [manifiesto de revisión](s01-review.json). Las comprobaciones siguientes describen esa preparación; el resultado del código está en la sección vigente superior.

## Estado S01 revisado

Fuentes: archivos públicos del worktree `C:/Users/Usuario/.codex/worktrees/9349/CRM Currated`, documentos de contratos/manifiestos/ADR, código pertinente y última entrega del chat **Pipeline OS — S01: identidad y estados**. Se consultó el chat únicamente para leer su estado; no se le envió ningún mensaje ni se inició trabajo allí.

| Entregable | Evidencia disponible | Estado acreditado |
|---|---|---|
| T01-01 | Mapa y ADR-001 aprobados por el usuario según tareas/entrega S01 | Aprobado documentalmente, sin declarar S01 completo. |
| T01-02 / I01 | Seis archivos presentes; fuente informa20/20 y TS correctos | Implementación local y aceptación previa, no repetida aquí. |
| T01-02 / I02 | 28 existentes modificados/cinco nuevos presentes; última entrega y sección9 de t01-02-verification | Implementación local. Fuente informa144/144 ampliados y finales13 SQL +4 API/SSR/worker; se solapan, no sumar. No repetir esas suites. |
| T01-02 integral | Documentos de integración/backfill/guardas de marca/snapshots, SQL marcado sandbox | No integrado ni completado. T00-02-I/O y numeración final pendientes. |
| T01-03 / T01-04 | Tareas y contratos preparatorios | Pendientes, no implementados por I01/I02. |

Algunas filas/cabeceras antiguas de documentos S01 conservan estados previos de preparación. La evidencia vigente es su última sección de implementación y entrega final; no se edita documentación ajena para ocultar esa cronología.

## Comprobaciones nuevas, exclusivamente locales

1. HEAD coordinador: fb9f2015e682fc0704340530425322efc62c601b; seis cambios documentales anteriores conservados (cuatro tracked y dos sin versionar).
2. Extracción de manifiesto:28 paths existentes I02 y11 añadidos I01/I02. Todos están presentes en S01; los11 nuevos no están en el coordinador. Huellas SHA-256 en s01-review.json, sin copiar fuentes de producto.
3. Los28 existentes del coordinador coinciden, normalizando CRLF/LF, con el contenido de la base común ae0c42c. Los28 archivos de S01 difieren de su versión actual aquí. No afirmar merge realizado ni integración segura a partir de esa comparación.
4. Las45 migraciones001–045 coinciden byte a byte entre ambos checkouts. El coordinador tiene47:046/047 son posteriores y deberán entrar en la revisión del delta S01 antes de integración.
5. Inspección de la fachada y todos los sitios de llamada gmail/gmailToken en src y worker: fachada compartida, callback final en sendNext, cuotas/caché existentes y ausencia de adaptador productivo Composio. Lectura del proxy S00 para fijar su contrato observado, sin ejecutarlo.
6. QA documental: **PASS** con Node22.23.4; siete Markdown/un JSON,19 enlaces locales resolubles, ocho FR/diez AC/seis tareas, cobertura FR→AC y ocho paths futuros (solo google.ts existe actualmente). Las39 huellas públicas S01 y28 fuentes actuales del coordinador siguen iguales al snapshot de revisión. git diff --check correcto. No se ejecutaron tests de producto o red.

El primer comprobador documental buscaba AC05 como literal y no expandía AC04/05: produjo un falso fallo de trazabilidad. Se corrigió la expansión de las referencias abreviadas, sin retirar o modificar criterios, y la comprobación completa pasó. No fue un fallo de producto ni una prueba funcional repetida.

Un git status ejecutado con cwd del worktree S01 devolvió «must be run in a work tree» en esta sesión. No se reparó Git ni se alteró ese checkout. Por eso esta revisión acredita archivos/hashes y la entrega del chat, **no un índice limpio ni un commit final de S01**. La base indicada por su manifiesto es ae0c42c; una integración posterior deberá resolver/comprobar su estado Git explícitamente.

## Baseline operativo aceptado: no repetir

- Usuario confirma envío y recepción de correo, conversaciones, adjuntos, descarga y vista previa ya operativos.
- PRUEBA.csv: captura de19/19 completed,12 importados,5 duplicados,0 omitidos/2 errores. Usuario confirma12/12 en preparación/pendientes.
- Captura de verificación posterior:12/12,11 válidos/1 incierto/0 inválidos/0 pendientes. Usuario confirma11 convertidos y1 en revisión. La ejecución de Bouncer la hizo el usuario; no fue una llamada del agente.
- Captura Coolify del trabajador: curated-worker Running y despliegue fb9f201 Success, igual que la web previamente confirmada. Logs aportados muestran tareas gmail_sync/gmail_sending_usage completed en ese fragmento; no son medición de toda la operación.

No se reabre el piloto existente para preparar S02. Su aceptación funcional no prueba transporte Composio en producto, políticas futuras S01 o SLA poblacional. Las pruebas del adaptador nuevo cubrirán únicamente esa diferencia.

## Gates y límites

G0: revisión realizada. G1/G2/G3: artefactos de I01 preparados bajo decisiones existentes y posteriormente implementación autorizada por el usuario. G4/G5 de I01: completados localmente según el resultado superior. G6: no solicitado. S02 y la habilitación real de Composio no se dan por completados.

Durante la preparación no se ejecutaron tests de producto, typecheck/build, Next, worker, APIs, OAuth, lecturas/escrituras de Supabase o nuevos envíos. La implementación posterior sí ejecutó únicamente los nuevos tests/TS/formato y comprobó hashes de los49 JSON privados, sin abrir env ni tooling de S01 o copiar sus fuentes. No se invoca un ejecutor S00 ni se toca su journal: Instantly permanece43, cero llamadas/reescrituras. No se afirma una nueva lectura de los valores secretos/IDs ni aceptación remota.

Rollback de preparación: retirar solo documentos/referencias de este incremento. El rollback de código se describe arriba; no se ejecutó ninguno. Siguiente: preparar la integración S01 y binding por cuenta. La activación real sigue dependiendo de esos contratos y de un corte posterior autorizado.
