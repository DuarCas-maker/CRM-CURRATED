# QGR-I04 — asociación v2 integrada y camino a primer buzón Composio

10/11/2026 · SDD STRICT · A/R autorizado e implementado localmente como un paquete;
I04-B sigue diferido. [Resultado](i04-implementation.md). SDD orquesta supabase-engineer para persistencia y premium-ui-builder
para UI. Gmail directo conservado, Composio apagado, Instantly43/0 nuevas. Sin
proveedores, datos privados, SQL remoto, push o despliegue. Solo se usaron el
clúster propio de prueba y un fixture visual loopback, detenidos al terminar.

## G0 / alcance confirmado

Se reutilizan las decisiones del operador: primer buzón CRM existente de Daniel,
marca Curated Financial, conexión Platform original y owner exacto, scopes mínimos,
Hobby y grupo conservador incluyendo Gmail directo. La solicitud de implementación
autoriza A/R y sus pruebas locales; no activa el proveedor.
No hay nueva decisión de negocio necesaria para este plan. No se inventa cuenta,
Google Project ID, credencial, asignación o presupuesto real.

**ADR-I04-01:** priorizar I04-A (asociación existente) + I04-R (compatibilidad del
transporte v2, todavía cerrado) para el primer piloto. I04-B (Connect/alta nueva y
reserva antes de materializar) se conserva pendiente y NO bloquea ese piloto.
No declarar todo I04 completado al terminar A/R. Esto ordena la decisión previa de
usar el buzón existente, sin suprimir el alcance de cuentas nuevas o recepción.

## Discovery comprobado

| Superficie actual                                             | Hecho / consecuencia                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| composio-bindings.ts y componente homónimo                    | Comandos/página v1 exigen Google quota project. La UI permite registrar/revocar, pero no comprobar/confirmar.                                                                       |
| API accounts/[id]/composio                                    | GET página y POST comando; no compone por sí misma C2 ni tiene endpoint de check.                                                                                                   |
| composio-binding.ts                                           | Orquestación C2 inyectable existe, pero importa verificador/contexto y DTO v1. Reutilizar patrón, no presentar como ruta publicada v2.                                              |
| I03/TI                                                        | Provider y verificador v2 con tokeninfo están implementados offline;81 checks focalizados y137 de regresión reportados en su evidencia. Sin prueba real de proxy→tokeninfo.         |
| SQL local I02                                                 | v2 permite candidato y FK de política, pero binding_quota_contract_check prohíbe status verified para v2. Necesita evolución controlada al introducir evidencia sellada.            |
| contract.ts/selection.ts/runtime-context.ts/composio-proxy.ts | ResolvedComposioBinding/snapshot/context/preparación todavía exigen quotaProjectId. Guardas bloquean un v2 genuino sin Google; no alcanza con añadir botones.                       |
| runtime-context.ts                                            | composioProductOperationEnabled=false. I04-R conserva ese cierre.                                                                                                                   |
| worker/gmail-schedule.ts                                      | Ya agenda gmail_sync y omite gmail_watch para proveedor Composio. Reutilizar reconciliación existente; no crear webhook nuevo para empezar.                                         |
| worker/gmail.ts                                               | Consulta sendAs al preparar firma si falta. GET sendAs admite gmail.readonly según referencia Google; no imponer scopes adicionales a partir de la operación de crear/editar firma. |
| Connect/F2                                                    | Config/contratos siguen v1. Solo se inspeccionó el checkout coordinador y el manifiesto importado; no se certifica estado actual de otro chat/worktree. No editarlo ni copiar WIP.  |

Fuente de permisos sendAs:
[Google GET sendAs](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/get).
La lectura documentada es compatible con readonly; la aceptación real por buzón
continúa pendiente. No repetir pilotos de recepción/adjuntos/importación aceptados,
salvo el delta de continuidad del transporte que se cambie.

## Spec / requisitos

| FR       | Resultado requerido                                                                                                                                                       | AC    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| I04-FR01 | Asociación existente v2 sin Google obligatorio, preservando cuenta/historial/marca/owner y v1. Ningún registro llama OAuth o cambia transporte.                           | 01,02 |
| I04-FR02 | Comprobar desde una ruta servidor autorizada con MFA, Origin, nonce, deadline y contexto v2; proveedor construido solo después de autorización y presupuesto del intento. | 03,04 |
| I04-FR03 | Persistir evidencia v2 auténtica y mínima; confirmar exclusivamente por humano activo con evidencia vigente y revisiones exactas.                                         | 05,06 |
| I04-FR04 | UI de registrar→comprobar→confirmar, con identidad/marca visibles y estado de transporte separado, errores ES/EN y uso móvil/teclado.                                     | 07,08 |
| I04-FR05 | Lectores de ticket/runtime/transporte aceptan v1/v2 discriminados sin exigir Google en v2 ni saltarse cuota/admisión/escritor único. Sigue apagado.                       | 09,10 |
| I04-FR06 | Cambios aditivos/compatibles, contratos previos/SQL sellado/contadores intactos; reservar los archivos y coordinar F2 antes de editar Connect.                            | 11,12 |

No objetivos de A/R: OAuth nuevo, diez buzones, campañas, Instantly C/D, importación
histórica masiva, mutación de Gmail, corte automático, revocación de credenciales
directas o acceso a secretos. No añadir dependencias. No permitir que service_role
apruebe una asociación humana ni que el browser aporte hechos/permiso/policy vigente.

## Diseño A — comandos, evidencia y UI

1. **Contrato dual explícito.** Preservar entrada v1 no versionada. El cliente nuevo
   solicita GET con contract_version=2 y POST con envelope contract_version=2;
   desconocido/campos mezclados fallan. DTO v2 distingue quota_contract_version,
   política/generación, contexto y revisiones. No reinterpretar receipts/checks v1.
   Registrar v2 acepta solo candidato y expected revisions; policy/actor/identidad
   esperada proceden del servidor. project/auth config pueden prellenarse desde
   configuración revisada; ca/owner del candidato se validan exactos y nunca se crean.
2. **RPC versionadas propuestas.** composio_binding_page_v2, command_v2 y
   check_context_v2/begin_v2/snapshot_v2/finish_v2. El nombre final se decide al
   implementar tras inventario. Mantener funciones v1 selladas; SQL aditivo local
   en esta carpeta, sin ordinal hasta I05. Context/check/head/receipts versionados
   y FK/uniqueness global de ca conservadas. Autorizar antes de replay/lectura de
   datos y antes de escrituras privilegiadas, repetir bajo locks en DB.
3. **Prueba sellada.** Begin humano genera intento ligado a actor/session/account/
   binding/revisiones/contexto/política y TTL; nonce solo backend. Snapshot service
   requiere nonce. Finish service acepta resultado del verificador de ese intento,
   no hechos del navegador. Extender el resultado backend I03 con recibo mínimo
   de procedencia y valid_until de la prueba efectiva (hoy expone solo booleanos).
   DB limita el recibo al deadline de begin; no inventar un nuevo60s al persistir.
   Revalidar vigencia al terminar y al confirmar. Evidencia caducada exige nuevo
   check; no regenerar nonce o consumir APIs por un replay incierto.
4. **Confirmación separada.** command confirm del humano exige check completed,
   contexto/actor/session/revisiones vigentes; una transacción confirma/audita o
   revierte. Evolucionar constraint v2 únicamente junto con estas guardas y tests;
   nunca quitar status<>verified de forma aislada. El transporte sigue gmail_oauth.
   La frescura del check no implica llamar tokeninfo cada minuto: binding confirmado
   conserva validez sujeta a contexto/estado/revocación y guards runtime existentes.
5. **Presupuesto de check.** Hook servidor obligatorio, persistido por intento, con
   máximo4 admisiones de red: conexión/config/tokeninfo/perfil. Marcar antes del
   wire, contando fallos y emisiones inciertas; sin retries ni remanente S00. El
   lector de página/registro/revoke/confirm usan0 proveedores. Check no inicia por
   render/poll/GET. Autorización de ensayo y cupo independientes del flag de envío.
   La reserva diagnóstica opcional1 no es un retry automático del botón.
6. **HTTP.** Reutilizar wrapper de sesión/MFA/superadmin/Origin/body16KiB/no-store.
   Proponer POST accounts/[id]/composio/check para la comprobación v2; rutas de
   comando siguen misma familia, con branch por versión. Inyectar human/service,
   context, budget, clock y fetch, de modo que tests no carguen env ni red real.
   Error HTTP saneado; no devolver key, owner completo, nonce, token, claims o
   raw provider. Autorizar antes de construir service/factory o leer credenciales.
7. **UI.** Reutilizar panel, Modal, ProtectedForm y controles del CRM. Ocultar el
   campo obligatorio Google en modo v2. Mostrar cuenta/marca, candidato, resultado
   de check, vigencia y acción confirmación como pasos distintos. Texto explícito:
   asociación verificada, transporte Gmail directo, Composio operativo apagado.
   Botón check explica hasta4 peticiones/sin envío y solo está disponible si hay
   autorización/cupo del ensayo. Ningún input técnico innecesario en flujo normal.
   Busy/focus/errores/carga/vacío/sin permiso/stale conservan el formulario; replay
   mismo intent no duplica check ni vuelve a consultar al proveedor.

## Diseño R — contrato de operación v2, aún sin activación

Versionar binding/ticket/config/snapshot/adquisición-validación de runtime de forma
discriminada. Rama v1 conserva quotaProjectId real; v2 exige política/generación y
Google null, usando reserva I03. No poner un UUID de grupo en quotaProjectId ni
relajar parsers a string opcional sin discriminante. Adaptar el resolved binding
del proxy y la preparación/cuota para que v2 no dependa de un project legacy.

SQL runtime nuevo valida binding verified v2/política/contexto/route revision y
rechaza binarios v1 antes de credenciales. Reutilizar nonce/capacidad, before-wire,
admisión única y finish/uncertain. Un check no proporciona capacidad de envío.
Constante producto false y routing off por defecto; seleccionar Composio requiere
un paso operativo posterior. Mantener Gmail directo y sus credenciales para reversa.

La recepción Composio usará el reconciliador/scheduler ya existente y los mismos
IDs Gmail/cursors/dedup/adjuntos, no un escritor adicional. Conservar la exclusión
de watch/stop para Composio y probar jobs viejos con route revision stale. El envío
usa outbox/brand guard/capacidad existente, sin fallback tras un resultado incierto.
No activar firmas/alias adicionales ni cambiar semántica de contenido al adaptar v2.

## AC / verificación prevista

| AC  | Given / When / Then                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | Con candidato v2 sin Google, registro conserva cuenta/marca/owner y estado candidato;0 proveedores.                                              |
| 02  | Con v1 existente/campos cruzados/version desconocida, v1 conserva semántica; entradas ambiguas rechazan y no degradan a v1.                      |
| 03  | Sin sesión/MFA/superadmin/Origin/revisión válida, no factory/servicio/HTTP; también ante revocación durante espera.                              |
| 04  | Dos clics/replay/crash tras admisión no duplican tokeninfo/perfil ni exceden4; cuotas agotadas bloquean sin red.                                 |
| 05  | Tokeninfo/perfil válidos finalizan check exacto, pero no verifican binding hasta confirmación humana explícita.                                  |
| 06  | Caducidad entre respuesta y finish/confirm, cambio de política/brand/owner/contexto o nonce inválido bloquean atómicamente; no borrar evidencia. |
| 07  | UI muestra estados separados, sin Google obligatorio v2, sin API key y con botones que no disparan al montar.                                    |
| 08  | A360/768/1280px, teclado/foco/errores/busy/stale funcionan, ES/EN y navegación protegida conservadas; requiere observación visual.               |
| 09  | Runtime v2 sin Google usa cuota agregada y lease; v1 sigue funcional; disabled/in-flight/stale se rechazan antes de credencial/wire.             |
| 10  | Composio sigue code-disabled;0 envíos/reintentos/fallback; sync/adjunto/firma preservan IDs, sin nuevos watch Composio.                          |
| 11  | PG15 aislado prueba permisos humano/servicio, CAS, dos conexiones, rollback con datos y preservación de039/048–051/I01–I03.                      |
| 12  | F2/archivos fuera del manifiesto intactos; fuentes/SQL versionados por huella, sin ordinal/servicios/API real por preparar.                      |

Pruebas previstas: contrato/HTTP/componentes con dependencias falsas; PG15 propio
usando solo binarios ya disponibles y fixture propio; carreras y reversa; mocks
de fachada/runtime; typecheck/formato; revisión del delta. QA visual en instancia
ficticia local requiere alcance explícito de ejecución cuando se implemente UI.
No repetir pilotos aceptados ni aprobar el flujo por SSR/mocks solamente.

## Tareas y salida

| Tarea  | Alcance                                                      | Dependencia / salida                                                    |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| I04-A1 | DTO/comandos/página v2 y contratos de config/errores         | FR01/06; inventario/compatibilidad cerrados                             |
| I04-A2 | SQL local de checks/receipts/budget y confirmación v2        | A1; AC03–06/11, reversa PG15                                            |
| I04-A3 | Servicio/HTTP con factory I03 y recibo efectivo              | A2; AC03–06,0 red real                                                  |
| I04-A4 | Panel de asociación integrado                                | A1/A3; AC07/08 y revisión visual ficticia                               |
| I04-R1 | Contrato runtime/ticket/config/proxy v1-v2 y SQL de contexto | A1/A2; AC09/10 sin activar                                              |
| I04-R2 | Regresiones integración web-worker y preservación            | A3/A4/R1; AC01–12 y manifiesto final                                    |
| I04-B  | Scope de cuota previo a nueva cuenta y adaptación Connect    | Posterior al primer piloto; snapshot F2 final/propiedad antes de editar |

Implementación A/R autorizada por el usuario el10/11/2026, como un solo paquete.
La base previa está conservada en i04-implementation-baseline.json. Se añaden
dos campos de integración compartida: indicador no sensible del contrato en
Workspace y elección del panel en Integrations. El presupuesto se acredita por
RPC humana/MFA y queda ligado a actor, sesión, contexto y caducidad; ningún GET
lo crea ni lo renueva. Un RPC de autorización humana precede a toda factory de
servicio y lectura de configuración privada. El SQL candidato conserva los
cuerpos v1 en funciones privadas para delegación y reversa sin borrar historial.
Consultar i04-manifest.json para rutas propuestas y
huellas base, no transferencia implícita de archivos. A1–R2 constituyen UN paquete
de implementación autorizable; no exigir una aprobación nueva para cada función.
Si hay un fallo, reparar el delta y repetir únicamente sus checks pertinentes.

## Camino mínimo y estimación orientativa

| Hito                              | Qué permite                                                                                          | Esfuerzo estimado, sin garantía de calendario |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1. I04-A/R implementado y probado | Guardar/comprobar/confirmar desde app y consumir contrato v2 sin habilitar Composio                  | 8–16h                                         |
| 2. I05 publicación conjunta       | SQL final nuevo, preflight/postflight, web+worker compatibles, smoke; políticas/corte aún cerrados   | 4–8h                                          |
| 3. Comprobación real Daniel       | Cupo/config privados revisados, hasta4 peticiones normales,1 diagnóstica solo si autorizada;0 envíos | 1–2h de preparación/ventana                   |
| 4. Corte piloto de un buzón       | Lectura incremental y luego envío/respuesta controlados, sin doble escritor y con reversa revisada   | 2–4h más observación                          |

Total orientativo15–30h, aproximadamente2–4 jornadas técnicas, si no hay diferencias
de catálogo/build/cupo y proxy→tokeninfo funciona. No promete lanzamiento hoy ni
tiempo fijo de ejecución de un chat. La primera prueba real de permisos puede
ocurrir antes del corte; la operación completa se acepta después del piloto.

Si tokeninfo es rechazado, detener el intento y diagnosticar su contrato con reserva
aprobada; no extraer tokens ni cambiar OAuth automáticamente. Ese riesgo puede
añadir trabajo y es la mayor incertidumbre externa actual. Faltan datos reales de
cupo/configuración vigente; ni pruebas offline ni screenshots antiguos los certifican.

Después del piloto: ampliar a los demás buzones, adaptar alta nueva, reanudar jobs
gradualmente y observar consumo. Instantly C/D y nueva carga histórica no bloquean
el primer buzón Composio. Conservar credenciales directas para reversa; dejar de
usarlas para ese buzón es el corte de routing, no revocarlas antes de aceptación.

## Rollout/reversa

I05 preparará un SQL final NUEVO y bundle web/worker para este delta; nunca volver
a aplicar048–051 ni ejecutar candidatos marker-only en producción. No hay número
reservado hoy. Publicar solo tras pruebas/catálogo y autorización concreta.

Durante el corte, cerrar admisiones del buzón, conciliar queued/sending/uncertain y
revisiones; habilitar política/cuota/routing y proveedor solo mediante protocolo
revisado/autorizado. Primero lecturas, después mensaje piloto autorizado aparte.
No dejar worker entero libre por comprobar un buzón. Volver al directo únicamente
sin intentos ambiguos/en vuelo, conservando mensajes, receipts, cursor y auditoría.
No auto-fallback después de un envío incierto ni reiniciar contadores.
