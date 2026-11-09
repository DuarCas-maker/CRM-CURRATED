# R06-I01 — implementación y verificación offline

08/11/2026 · SDD STRICT · autorización humana «hazlo». [Diseño concreto](i01-design.md), [manifiesto del incremento](i01-implementation.json), [continuidad e integración](i01-runbook.md).

## Resultado

**180 casos/grupos correctos de181 enumerados por Node; cero fallos, uno nativo omitido por defecto.** 37 nuevos R06-I01 y143 de regresión seleccionada. Node22.23.4, preload que deniega red real fetch/HTTP/HTTPS/socket/TLS/DNS y dependencias ficticias. No sumar nuevamente los37 del ensayo aislado, los14 de revisión del resolvedor ni el heartbeat aislado.

TypeScript `--noEmit --incremental false`, formato, enlaces, preservación por hashes y diff-check correctos. Los registros privados y sus huellas se identifican en el manifiesto. No se ejecutaron llamadas de proveedor, SQL remoto, migraciones048/049, servicios normales, envíos, instalaciones, push o despliegue.

## Trazabilidad

| T / FR-AC      | Implementación y evidencia                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 / 01–03,05 | Contratos Zod estrictos y resolvedor solo servidor con ports obligatorios. Rechaza absent/error/foreign/expired antes de preparar credencial, presupuesto previo y segunda validación tras esa espera; quota/hook/admit una vez. Ticket/binding congelados; cero fallback o retry, error saneado.                                                                                               |
| T02 / 03–04    | Tres tablas privadas RLS sin DML/SELECT directo para anon/authenticated/service_role, dos RPC humanas y cuatro de servicio. Sesión viva superadmin/MFA reutilizada de R05, CAS/idempotencia, drenado/revisiones. DDL y cuatro sustituciones C2 revierten juntas; resto de cuerpos/ACL existentes conservados.                                                                                   |
| T02–03 / 04–05 | Reserved/admitted/uncertain impiden commit aunque venza el ticket. Cola queued exige pausa explícita; campañas/inscripciones activas y jobs en vuelo también bloquean. Escritura única por outbox, resource/capability exactos, B2 obligatorio antes de admitir, permiso revocado deniega. Estado incierto solo se cierra como finished con outbox sent/admisión B2 accepted; no otro envío.    |
| T02–03 / 06    | Cursor decimal exacto independiente de credencial, copia única inicial, CAS/monotonicidad/una actualización por ticket, no avance desde revisión anterior. Histórico/credenciales conservados. La integración real de syncMailbox/scheduler es I03, no se ejecuta hoy.                                                                                                                          |
| T02–03 / 07    | R05 ficticio completo→cuenta disconnected→verificador C2 real con tres dependencias falsas y grants efectivos explícitos→confirmación humana→selección explícita. No se inventa token ni marca connected para verificar. Contextos pre/post ligados, epoch detecta cambio identitario ABA y permite cambios operativos no identitarios. C1 ready comercial general sigue false hasta el commit. |
| 08–10          | Ningún caller, ruta, componente o worker activo editado. Cuenta nueva no obtiene live/sync/can_send por seleccionar transporte. Conservación del WIP, fuentes históricas y privados; Gmail directo fijo en producto, Composio apagado e Instantly43/0 nuevas. Guardas de callbacks/push/watch y QA visual son I02/I03 pendientes.                                                               |

## Archivos y revisión

Seis nuevos: tipos públicos, módulo servidor, SQL local, dos tests y una fixture. No se modificaron fuentes de aplicación existentes ni los SQL originales C1/R05/WC/048/049. El candidato R06 contiene las sustituciones aditivas guardadas por MD5 normalizado LF de `check_current`, `approval_current`, `row_dto` y `composio_binding_check_begin`; no cambia sus ACL ni las guardas nonce/TTL/xmin/actor/configuración.

El SQL nuevo contiene un trigger de época identitaria sobre mail_accounts y registra xmin solo como auditoría después de consumir la aprobación. Usar xmin indefinidamente habría invalidado el transporte al modificar live_enabled o límites de uso. C2 conserva su control xmin durante la verificación; el estado operativo usa época monótona y contexto/revisiones, sin perder detección ABA.

La revisión confirmó y corrigió dos defectos del resolvedor mediante pruebas que fallaban antes del cambio y pasan después: mutabilidad del ticket entre awaits y revocación durante el control de presupuesto antes de preparar credencial. También se corrigieron dos conflictos PL/pgSQL de nombres detectados al ejecutar ramas nuevas; no se relajó ningún test o guarda para hacerlos pasar.

La primera selección ampliada detectó además que el test heredado de entrada paused no produjo heartbeat dentro de10s. Sin cambiar su umbral ni fuente, pasó aislado y en la selección completa final. La evidencia compilada usa resolución de Next propia de fixture y no certifica arranque de imagen Linux.

## Límites

PGlite acredita lógica/DDL/ACL/transacciones del ensayo; **no concurrencia física PostgreSQL15 multiconexión**, GoTrue real, mapping vigente del proveedor, capacidades reales de cuota/scopes, OAuth, configuración productiva, red, build Linux o QA visual. La prueba nativa T-002 no se inicia aquí; se mantiene opt-out explícito. No se hereda su evidencia para certificar este delta.

La operación de los puertos `execute/finish` es un ciclo controlado completo: para send, el executor futuro debe incluir la persistencia aceptada mediante B2 antes de finished. I02 debe integrar el ciclo con sendNext y su finalización; **no insertar este helper como un simple reemplazo de gmail() que intente finalizar antes de mark_sent**. No se ha cambiado la firma pública ni movido lógica del caller hoy.

Una réplica antigua/normal o emisores web no usan estos permisos mientras I02/I03 no estén integrados. La lease no los detiene. Una lectura con resultado incierto queda bloqueada hasta un protocolo de conciliación explícito posterior; no se ofrece liberación automática por timeout. El permiso general de producción recibido sigue vigente, pero R06 completo todavía no es una versión operable.

## Cierre del incremento

R06-T01–03 completadas para implementación y ensayo local. I02/I03, SQL final numerado/preflight/postflight, contención nativa, corte real y aceptación operativa permanecen pendientes. [Manifiesto](i01-implementation.json) fija fuentes y checks; el manifiesto de preparación conserva su alcance histórico y enlaza esta entrega.
