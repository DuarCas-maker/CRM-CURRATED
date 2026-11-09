# R06-I01 — continuidad e integración

Implementado y probado offline; no activado. [Evidencia](i01-verification.md), [contrato](i01-design.md), [tareas posteriores](tasks.md).

## Estado conservado

La fachada de producto sigue en gmail_oauth fijo. No hay import del resolvedor nuevo desde google.ts, rutas o worker. La configuración real no cambia. El SQL r06.local.sql conserva el marcador obligatorio y no es una migración para pegar en producción. No volver a ejecutar048/049; no leer env/contadores o copiar privados de F2/F3.

## Reproducir localmente

Usar Node22 y dependencias existentes. Con un preload de bloqueo de red equivalente al usado por el coordinador, ejecutar `node --import <offline.mjs> --import tsx --test --test-concurrency=1 tests/pipeline-os-s02-transport-selection.test.ts tests/pipeline-os-s02-transport-selection-db.test.ts`. Las fixtures crean/cierra PGlite en memoria, Auth/JWT/sesiones/tuples ficticias y adaptan en memoria solo la guarda de host del T-002 fijado por hash. No iniciar PostgreSQL nativo o usar un cliente remoto por ejecutar estos tests.

La selección de regresión y la evidencia exacta están en el manifiesto. El test nativo T-002 queda deshabilitado salvo opt-in propio explícito; no copiar su toolchain privada ni atribuir este ensayo a PostgreSQL15 físico.

## Próximo incremento I02

1. Conservar el delta y los seis paths propios; integrar solo entregas terminadas F2. Reutilizar contratos R05/C2 sin apropiarse de su orchestrator o copiar parciales.
2. Concretar el adapter de store/configuración real y el enlace de verificación, con origen revisado de proyecto/cuota/scopes efectivos. Un permiso de alto nivel no permite adivinar la identidad ni el contrato externo.
3. Conectar selección antes de gmailToken, cuota y guardas WC/B2. La rama Composio no lee/renueva la credencial directa. Mantener un intento, errores separados y ningún fallback.
4. Integrar la finalización del intento **alrededor del envío y su persistencia actual**: mark_sent/B2 accepted antes de finished. Mantener la firma pública Gmail y la conciliación de sendNext; no dar por terminada una entrega solo por outer200/timeout sin resultado persistido.
5. Comprobar composición del orden de locks y admisiones con claims/callbacks, más casos con contexto obsoleto, error DB tras aceptación, réplica/reinicio y resultados inciertos. No abrir una ruta de activación pública antes de tener estos controles.

I03 incorporará cursores/scheduler/polling por cuenta, protección de callbacks/push/watch antiguos, panel y QA del delta. No crear credenciales ficticias para solventar la dependencia antigua de mail_credentials. El cursor histórico ya existente se conserva independiente.

## Publicación y reversa futuras

Preparar el SQL definitivo del delta completo y versiones compatibles, sin reutilizar los candidatos de ensayo ni repetir049. Publicar mediante el Coolify existente bajo la autorización general recibida, con emisores pausados y autoarranque/réplicas conciliados. Las guardas de esta biblioteca solo controlarán participantes nuevos; detener/drenar binarios que no las respeten es un requisito real, no una propiedad simulada.

Antes de cambiar una cuenta: sesión/MFA, identidad/marca/permisos/evidencia y revisiones actuales; pausar explícitamente queued/campañas/inscripciones, conciliar running/sending/uncertain, revisar histórico/uso/notificaciones y presupuesto privado de proveedor. Prepare marca draining, no corta HTTP ya emitido. Un vencimiento no demuestra que terminó. Commit no concede membresías/can_send ni habilita live/sync, y no reanuda colas.

Reversa exige el mismo drenado y una credencial directa legítima; cuenta Composio nueva sin ella permanece pausada, no genera token ficticio. Conservar IDs/cursor/Message-ID/evidencia y no hacer otro POST para resolver incertidumbre. En I01, una escritura incierta solo se finaliza cuando la conciliación existente acredita sent/B2 accepted; las lecturas inciertas no tienen auto-liberación. No borrar estado o aumentar cupos para esquivar el bloqueo.

Reversa local de este incremento: excluir sus seis adiciones y referencias documentales tras conservar evidencia, sin reset/stash/clean sobre el WIP. El ensayo demuestra que una transacción externa ROLLBACK retira tablas/trigger y restaura las cuatro funciones C2. No ejecutar esa reversa contra producción por este documento.
