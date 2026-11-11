# QGR — cuota interna y reutilización de conexión Gmail

Preparación I04 autorizada10/11: [plan de asociación/comandos/persistencia/UI y puente
runtime](i04-plan.md). ADR-I04-01 prioriza el primer buzón existente; alta nueva se
mantiene en I04-B posterior. No hay código/SQL nuevo ni activación en esta preparación.

Actualización I03-tokeninfo10/11: [CR-TI01 y contrato](i03-tokeninfo.md) implementados
offline por autorización explícita. Grants se consultan a Google mediante proxy
Composio fijo; ya no se usa el null incondicional. [Evidencia actual](i03-tokeninfo-verification.md).
La compatibilidad real de esa composición, I04, publicación y ejecución siguen
pendientes. Las constancias siguientes describen etapas anteriores y no las revocan.

Actualización10/11: I01 autorizado, implementado y probado offline en sus dos archivos nuevos; [contrato concreto](i01-design.md) y [evidencia](i01-verification.md). El módulo no está importado por producto. La planificación original siguiente y los restantes incrementos conservan sus límites; ningún transporte, SQL o proveedor se activa por este resultado.

I02 autorizado posteriormente: [diseño SQL](i02-design.md), [verificación nativa](i02-verification.md). Solo políticas/reservas/compatibilidad en fixture propio PG15; no hay integración con callers ni migración remota. La reutilización de binarios de F2 fue autorizada de forma explícita y no incluye sus datos o configuración.

I03 autorizado después: [diseño de integración](i03-design.md), [resultado](i03-verification.md).
Admisión en fachada/runtime/perfil y verificador v2; flag nuevo false por defecto,
Composio sigue apagado. Las constancias anteriores son históricas. El cierre de I03
sigue pendiente de acreditar una fuente de grants efectivos.

10/11/2026 · SDD STRICT · planificación v1, implementación y ejecución no autorizadas. Responsable: coordinador F1. Cambio solicitado: simplificar el requisito del proyecto Google y preparar la asociación de la conexión original del buzón objetivo ya existente en Platform.

## Contexto y objetivos

El operador ya tiene una cuenta CRM con Gmail directo y marca confirmada. Las capturas y la evidencia histórica local identifican una conexión Platform candidata, con OAuth2 Custom, Auth Config habilitado y scopes declarados de identidad, gmail.readonly y gmail.send. Los identificadores reales y el correo permanecen fuera de estos documentos. La identidad actual, los grants efectivos y la disponibilidad de cupo no se certifican mediante capturas.

El contrato actual exige google_quota_project_id en la asociación, el contexto C2 y Connect. Además de formar huellas, ese valor alimenta el control local reserve_gmail_api. Proxy no necesita ese dato en el cuerpo de su solicitud. QGR elimina la obligación operativa de obtener el identificador Google, sin suprimir control de consumo ni inventar procedencia.

Objetivos medibles: un candidato existente puede prepararse sin Project ID de Google y sin crear un enlace OAuth; las solicitudes Gmail del CRM conservan límites agregados y por cuenta; ninguna asociación habilita transporte por sí sola.

## Usuarios, alcance y flujo

Superadmin activo con MFA/AAL2: registrar, comprobar y confirmar una asociación mediante acciones explícitas. Otros roles y servicio sin autorización humana no pueden aprobarla. El servicio solo reserva consumo y produce evidencia a partir de dependencias revisadas.

Flujo futuro: revisar configuración de proyecto Composio → preparar política interna → registrar candidato de cuenta CRM existente con la conexión exacta → comprobar identidad/permisos → confirmar explícitamente → conservar Gmail directo. Activar Composio, hacer histórico o enviar mensajes son alcances posteriores.

Fuera de alcance: migrar los diez buzones, cambiar propietario externo, borrar conexiones duplicadas, nuevo OAuth automático, lectura histórica, envíos, cambio de plan Hobby, cobros, otras integraciones, aplicación de SQL, instalación o despliegue. No repetir 048/049/050/051 ni pilotos aceptados.

## Clarificación y decisiones

| N.º       | Pregunta / origen                                                                                                                                                   | Respuesta confirmada                                                                                 | Consecuencia                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1, previa | Primer buzón de alta: existente o nuevo                                                                                                                             | El existente, marca Curated Financial; posteriormente se identificó su conexión original de Platform | Un buzón; preservar cuenta CRM e historial; referencias reales solo privadas |
| 2         | Si desconocemos el proyecto Google, ¿aceptar un límite compartido conservador, incluso para Gmail directo que pudiera compartirlo, aunque ralentice sincronización? | A. Sí, preparar grupo compartido y conservar Gmail directo activo                                    | FR02/03; no inventar equivalencia entre grupo interno y proyecto Google      |

Se reutilizan S01/A/B/C, MFA, CAS, escritor único, identidad exacta, cierre por defecto, Hobby e Instantly43. La ronda está cerrada para esta preparación; no se infiere consentimiento de implementación, API, publicaciones ni activación. Los límites numéricos propuestos son continuidad de los controles locales actuales, no una nueva cuota comercial contratada.

## Requisitos y aceptación

| FR       | Requisito                                                                                                                                                                                                              | AC       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| QGR-FR01 | La versión nueva no exige Project ID Google al registrar candidato ni al preparar configuración; permite metadato Google opcional con procedencia real explícita. Ningún valor ficticio satisface el contrato antiguo. | 01,02    |
| QGR-FR02 | Agrupar conservadoramente todo el tráfico Gmail del CRM cuando no se pueda descartar proyecto compartido, entre proveedores, Auth Configs y buzones; claves y límites proceden del servidor.                           | 03,04    |
| QGR-FR03 | Conservar Gmail directo, pacing por cuenta, control agregado, presupuesto diario y guardas después de esperas. La política nueva no reinicia consumo o abre salidas por faltar datos.                                  | 05,06,07 |
| QGR-FR04 | Reutilizar una conexión Platform exacta en una cuenta CRM existente, conservando su propietario técnico y contenido; no crear enlace, mover owner ni revocar otra conexión.                                            | 08,09    |
| QGR-FR05 | Revalidar desde servidor proyecto Composio, Auth Config, conexión/owner, Gmail primario exacto, estado y permisos efectivos; scopes declarados o una prueba antigua no bastan.                                         | 10,11    |
| QGR-FR06 | Mantener MFA/Origin, autorización en DB antes de replay, unicidad, CAS, idempotencia y auditoría; un candidato no activa permisos ni transporte.                                                                       | 12,13    |
| QGR-FR07 | Versionar contexto/política/evidencia y soportar datos v1; no reinterpretar evidencia antigua como v2 ni editar SQL sellado. Cambios concurrentes invalidan comprobaciones.                                            | 14,15    |
| QGR-FR08 | Coordinar delta con Connect F2 sin editar su worktree ni su WIP; preservar todas las fuentes de esta preparación, secretos e Instantly43.                                                                              | 16,17    |
| QGR-FR09 | Separar unidades Google, solicitudes Composio y cupo Hobby. Todo ensayo futuro cuenta intentos fallidos y requiere cupo y autorización propios; no hereda S00.                                                         | 18,19    |
| QGR-FR10 | Mostrar política interna y estados candidato/verificado/transporte por separado; no pedir Google Cloud ni presentar un grupo interno como saldo certificado del proveedor.                                             | 20       |

## No funcionales y reglas

- Sin nuevas dependencias. Node22/TypeScript/Zod/PostgreSQL15 y convenciones actuales.
- Presupuestos de operación no controlados por browser; DB decide grupo y generación. Entradas estrictas y lecturas/páginas acotadas según C1.
- Secretos solo servidor; fixtures ficticios; auditoría con IDs opacos y resultados saneados. Ningún correo, token, API key o enlace OAuth real en documentos públicos/tests.
- Timeout y deadline incluyen esperas de cuota; revalidar antes de emitir. Cero retry automático de envíos y cero fallback de proveedor.
- El límite global cubre solo el tráfico de esta instalación. Otros clientes que usen el mismo proyecto Google no quedan medidos; no se promete ausencia de 429, costo cero o saldo externo por controlar localmente.

## Estados, errores y dependencias

Candidato → comprobación vigente → confirmación humana → verified; transporte sigue gmail_oauth. Incompleto/permiso no demostrado/proveedor no disponible/conflicto/revisión stale mantienen el bloqueo y el contenido previo. No se autoabre OAuth al fallar.

HTTP mantiene 400 entrada inválida, 401/403 identidad/autorización, 404 no accesible, 409 CAS/conflicto/evidencia, 503 configuración/dependencia. La cuota agotada se distingue del fallo de identidad; no confirmar por tolerar el error.

Dependencias: diseño de política y migración versionados; adaptador C2 real con fuente documentada de grants; reconciliación con delta Connect T007-PD; ensayos PG15 y carreras; publicación posterior autorizada. El saldo Proxy/Hobby del período sigue desconocido. Supuestos nuevos de negocio: ninguno.

Historial: v1 preparada a solicitud del operador el10/11; los FR son objetivos, no comportamiento implementado.
