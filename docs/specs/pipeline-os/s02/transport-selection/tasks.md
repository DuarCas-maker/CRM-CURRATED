# R06 — tres incrementos y propiedad

I01, I02 y recepción/panel I03 implementados offline: **R06-T01–08 completadas localmente**, [I01](i01-verification.md), [I02](i02-verification.md), [I03](i03-verification.md). T09/T10, integración del alta/configuración real y operación pendientes; esta tabla no es una orden de ejecución remota. Coordinador propietario de producto compartido/SQL. F2 conserva alta R05/T-004/T-009 en su checkout; F3 revisa evidencia y QA en su carpeta. No se crearon otros chats ni se enviaron mensajes desde estos incrementos.

## I01 — estado, resolución y admisión offline

Primero, independiente del caller HTTP y del motor T-003 en curso. Sin cambios a google.ts o al flujo activo. Dependencias DB/proveedor/reloj falsas; SQL de ensayo con marcador y sin ordinal, PostgreSQL físico después.

| T       | FR / AC             | Entrega y definición de terminado                                                                                                                                                                                                            |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R06-T01 | 01–04,07 / 01–04,07 | Contratos Zod y estado/transiciones; resolver puro/injectable sin HTTP/env. Distinguir absent/error/paused/direct/composio y evidencia verified frente a selección ready. Nada se activa al importar.                                        |
| R06-T02 | 03–05,07 / 03–05,07 | SQL aditivo local de rutas/attempts/cursor, ACL/RLS/recibos, puente de elegibilidad C2 para R05 nuevo y versiones pre/post de activación; no quitar ready/TTL/nonce/CAS. Lock matrix de todos los caminos, DDL/rollback y pruebas negativas. |
| R06-T03 | 01–07 / 01–07       | Tests de cuenta incorrecta, revisión/lease/evidencia obsoletas, ABA, claim competidor y resultados inciertos. Primer incremento solo termina con sus pruebas en memoria y pendientes físicos diferenciados.                                  |

Selección I01 implementada: seis archivos nuevos, ninguno de F2 ni de producto existente:

1. `src/lib/mail-transport-selection.ts` — esquemas/DTO públicos saneados y comandos de selección; no tuple privada.
2. `src/lib/server/mail-transport/selection.ts` — resolvedor servidor y contratos de tickets/puertos privados.
3. `docs/specs/pipeline-os/s02/transport-selection/migrations/r06.local.sql` — candidato nuevo aditivo sobre049/CW, no editar ni reejecutar049.
4. `tests/pipeline-os-s02-transport-selection.test.ts` — resolución/presupuesto previo/proveedor equivocado con dobles.
5. `tests/pipeline-os-s02-transport-selection-db.test.ts` — ACL/transiciones/contexto C2/cursores/DDL revertido.
6. `tests/fixtures/pipeline-os-s02-transport-selection.ts` — datos propios ficticios sobre A/B/C/R05/WC; no privados de otro checkout.

Además, evidencia/manifiesto de esta carpeta. El SQL puede reemplazar funciones C2 dentro de **su ensayo**, con inventario exacto de firmas y preservación; no editar el archivo C1 original para ocultar diferencias. Las guards/ACL/signaturas afectadas se añaden al contrato de aplicación posterior. Ninguna llamada de verificación real en I01.

## I02 — fachada y escritor único

Estado: implementado/probado offline y ruta humana guardada. [Delta y límites](i02-verification.md). La configuración/adaptador reales no se acreditan con fixtures, y Composio permanece deshabilitado en producto.

Depende de I01 y del mapping real de configuración/verificación conciliado con F2, no de copiar sus parciales.

| T       | FR / AC                   | Entrega y definición de terminado                                                                                                                                                                        |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R06-T04 | 02,05 / 02,05             | Integrar selección en google.ts antes de gmailToken; cuota por proyecto/hook una vez, reserva/admisión después de esperas y finalización segura. Directo compatible y sin fallback ante fallo del proxy. |
| R06-T05 | 04,05,08 / 04,05,08       | Enlazar B2/WC y rutas humanas: no cambiar escritor con permisos o sending/uncertain pendientes, no librar por TTL, sesión/MFA/CSRF/CAS/idempotencia y lectores con DTO saneado.                          |
| R06-T06 | 02,04,05,07 / 02,04,05,07 | Regresión de transports/B2/C2/C3/WC, integración de callbacks/direct token/config y error externo vs Google. Pruebas de finalizaciones inciertas/aceptación HTTP con error DB y cero segundo POST.       |

Existentes coordinados: `src/lib/server/google.ts`, `src/lib/server/worker-request-control.ts`, `src/lib/server/mail-transport/{contract,composio-proxy,errors}.ts`, `worker/gmail.ts`; helpers C2 solo donde el puente lo exija y con contrato explícito. Nuevos propuestos: `src/lib/server/mail-transport/runtime-context.ts`, `src/lib/server/mail-accounts/transport-selection.ts`, `src/app/api/mail/accounts/[id]/transport/route.ts`, tests de API/fachada propios. F2 conserva composio-connect/** y su adaptador de alta; las dependencias se conectan después de su entrega. No se sustituye su orchestrator.

## I03 — recepción, interfaz y versión operable

T07/T08 implementadas/probadas offline: [diseño exacto](i03-design.md), [evidencia](i03-verification.md), [siguiente integración](i03-runbook.md). T09 solo tiene QA de fixture/parcial visual; concurrencia física, modal/app completa y SQL final pendientes. T10 no ejecutada. No confundir la implementación local de recepción/panel con una versión publicada y operable.

| T       | FR / AC             | Entrega y definición de terminado                                                                                                                                                                                                                                                                                   |
| ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R06-T07 | 06,08 / 06,08       | Cursor vivo independiente, copia inicial exacta sin secretos ficticios, scheduler por cuenta/polling Composio, guardas watch/push y callback directo tardío; revisar jobs históricos/uso/lectores. Conservar históricos y no repetir importaciones.                                                                 |
| R06-T08 | 03,07,09 / 03,07,09 | Panel por cuenta en Configuración: asociación vs transporte/paused/draining/ready, revisión humana, motivos claros y reanudación explícita. UI y permisos de F2 se concilian al integrar sus archivos terminados.                                                                                                   |
| R06-T09 | 01–10 / 01–10       | QA combinada PG15 físico (dos conexiones/locks/corte), visual/teclado ES/EN360/768/1280 y regresión del delta, catálogo/pre/postflight final nuevo y rollback; no repetir049.                                                                                                                                       |
| R06-T10 | 09–10 / 09–10       | Construir/publicar versión compatible con Coolify existente bajo autorización general ya recibida, recursos inicialmente controlados; después configurar una cuenta y protocolo piloto Composio con presupuesto explícito propio, conciliar y reanudar cohorte revisada. Sin afirmar que esta tarea esté ejecutada. |

I03 afecta `worker/index.ts`, `worker/gmail-schedule.ts`, `worker/gmail.ts`, `src/lib/gmail-sync.ts`, `src/app/api/gmail/push/route.ts`, callback directo y funciones de finalización OAuth, componentes de Configuración/bindings y tests relacionados. `worker/gmail-archive.ts` y `worker/gmail-sending-usage.ts` se revisan; solo editar si el delta requiere algo que no resuelva la fachada. No cambiar acceso a expedientes/fuentes ya aceptado.

Propiedad final de migraciones numeradas, manifest/pins, web/worker y despliegue sigue en el coordinador. No copiar .env, node_modules, .local, diarios ni datos reales entre worktrees. Las instalaciones, SQL/archivos de producción y configuración real se concretan antes de ejecutarlos; este encargo no introduce un nuevo veto a la autorización productiva del usuario.
