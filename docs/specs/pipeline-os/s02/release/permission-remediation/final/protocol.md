# Aplicación de PRM-FINAL-r1 — propuesta, no ejecutar todavía

## Qué se aplicaría

Un único script [048_restore_scoped_public_permissions.sql](048_restore_scoped_public_permissions.sql), seguido de [postflight.sql](postflight.sql) READ ONLY. [Hashes exactos y condiciones](manifest.json), [contrato](release-contract.json), [QA y límites](verification.md). No requiere desplegar web/worker o activar proveedores para efectuar este cambio de ACL.

Destino declarado: **Supabase self-hosted del CRM en https://supabase.finlabinc.com/**, recurso Supabase del mismo proyecto Coolify que contiene web CRM y curated-worker. No Supabase Cloud/Admin Charlom. El operador confirmará el destino por metadatos del recurso y su sesión habitual; no compartir URL de conexión, claves o env.

El ordinal **048** se reserva localmente para esta corrección. No se crea historial remoto ni se infiere que 048 esté libre globalmente: confirmar que no hubo otra reserva/aplicación desde PD/VR1 y que no se introdujo A/B/C u otro cambio de esquema. Si apareció ledger, otro 048, objetos o contrato diferentes, detenerse y reconciliar antes de pedir ejecución. La ausencia conocida de schema_migrations no se disfraza de historial completo ni obliga a crear un ledger.

La entrega permanece en este paquete versionable; no copiarla a supabase/migrations ni publicarla durante esta preparación. Su incorporación al proceso general de migraciones requerirá revisar instaladores/inventarios y fixtures que hoy parten de base47, además de autorización de publicación. El archivo con hash aprobado es el que se revisaría para ejecución manual en este CRM; su reserva no autoriza push o autodeploy.

## Antes de solicitar autorización de aplicación

| Control                  | Evidencia concreta requerida                                                                                                                                                                                                    | Estado al preparar                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Destino/estado           | Mismo recurso self-hosted del CRM; versiones y cambios de catálogo desde la instantánea VR1 reconciliados, reserva 048 sin conflicto. Sin secretos.                                                                             | Contexto PD/VR1 aportado; frescura operativa pendiente.                                                                       |
| Respaldo                 | Identificador/fecha del backup existente, alcance de DB/esquema/ACL y metadatos de roles necesarios; ubicación y responsable; procedimiento de recuperación y evidencia de restauración conocidos.                              | No verificado. No se crea backup remoto por este protocolo.                                                                   |
| Contención independiente | Evidencia de ensayo de locks/timeouts/rollback entre conexiones físicas independientes en PostgreSQL, separado de las pruebas en una sesión PGlite.                                                                             | Pendiente; los 39 locks sí se comprobaron localmente en una sesión. No exigir instalar algo por esta entrega ni simular PASS. |
| Ventana                  | Inicio/fin/zona, responsable, baja actividad, aviso acordado y exclusión de DDL/DCL/otras migraciones/cambios de roles durante aplicación y postflight. Considerar las 39 relaciones bloqueables, no solo las 28 ACL.           | Pendiente de acordar.                                                                                                         |
| Control de servicios     | Cómo evitar cambios concurrentes de esquema y autodeploy durante esa ventana. No parar/reiniciar web, worker o Supabase ni cambiar flags por inferencia; cualquier control de servicio necesario debe autorizarse expresamente. | Sin cambios o controles remotos ejecutados.                                                                                   |
| Artefacto y recuperación | SQL/contrato/postflight de este manifiesto, sin edición manual, con plan de recuperación revisado y responsable disponible.                                                                                                     | Preparados/probados offline; autorización pendiente.                                                                          |

Ningún control pendiente se convierte en confirmado por el éxito de VR1 o por este documento. La validación independiente de contención no fue autorizada ni ejecutada en producción; si requiere un ensayo remoto, se delimitará aparte con sus permisos y presupuesto. No está escondida dentro de las dos ejecuciones normales propuestas abajo.

## Autorización futura que habrá que concretar

Debe identificar **destino, SHA256 de 048 y postflight, ventana, respaldo/recuperación, exclusión concurrente y responsable**, y cubrir:

1. Una ejecución completa del SQL correctivo, con su preflight y validaciones dentro de la misma transacción.
2. Una ejecución del postflight READ ONLY para comprobar el resultado y conciliar una respuesta incierta.
3. Solo si queda una transacción abierta/abortada, hasta una ejecución condicional de **`ROLLBACK;`**, sin otra instrucción, para limpiar esa sesión. Debe incluirse expresamente en el permiso futuro; no es un reintento.

**Presupuesto normal: 2 scripts SQL; máximo 3 incluyendo esa limpieza condicional. Cero reintentos correctivos.** No son peticiones HTTP del editor. Cero llamadas de Instantly/Composio, envíos, verificaciones pagas o despliegues. Instantly permanece en **43**. VR1/PD ya consumidos no se vuelven a ejecutar. Las operaciones actuales autorizadas son solo preparación offline.

## Pasos de aplicación, después de superar los controles y autorizar

1. Confirmar la ventana y el recurso correctos en la sesión habitual del operador. No lanzar otras migraciones o cambios de permisos; no activar Composio/webhook/campañas. Guardar solo metadatos de control, no clientes o secretos.
2. Abrir una consulta nueva y vacía en el SQL Editor del CRM, con el actor esperado supabase_admin. Cargar el archivo **completo y con hash aprobado**. No seleccionar solo una parte, quitar precondiciones o usar el antiguo candidato de fixture.
3. Ejecutarlo **una sola vez**. BEGIN SERIALIZABLE fija timeouts 15s/2s y search_path seguro. Comprueba actor/roles/USAGE, footprint, objetos/columnas/huellas aceptadas/ACL; toma locks deterministas y revoca exclusivamente excesos. Ante discrepancia falla sin ampliar el alcance.
4. Conservar el resultado `pipeline_os_prm1_application` y el estado de éxito del script completo. El recibo lleva `stage=checked_before_commit`, contractSha256, `preservationMatches=true` y huellas before/after iguales. **El recibo se selecciona antes de COMMIT: por sí solo no acredita que se haya confirmado la transacción.** No reejecutar si falta el recibo o la respuesta es ambigua.
5. Si el script falla o hay timeout, detenerse. Si la sesión sigue abierta/abortada, cerrar solo con el ROLLBACK condicional autorizado; no reenviar el script, cambiar timeouts, matar sesiones o ampliar permisos. El presupuesto de limpieza es separado de los dos pasos normales.
6. Con sesión limpia, ejecutar el postflight autorizado una vez y compartir únicamente sus dos JSON técnicos —recibo y postflight— para comparación offline. Si falta autorización, no ejecutarlo. No lanzar consultas adicionales para resolver una salida incompleta.

La web/worker pueden encontrar esperas o errores breves durante locks; no se declara interrupción cero. Si no se pueden garantizar los controles o la ventana, no iniciar. El protocolo no autoriza suspender servicios por sí mismo.

## Criterios de aceptación del postflight

- protocol/ordinal/contractSha256 corresponden al manifiesto aprobado; READ ONLY on, search_path pg_catalog, pg_temp y contexto de actor/versión esperados.
- `objectsOk`, `allTargetsOk`, `humanRolesOk`, `serviceRoleReady` y `footprintMatches` son true. Las 28 relaciones tienen targetOk=true, anon vacío y los objetivos authenticated 23 SELECT / dos CRUD / tres vacíos.
- `protectedFingerprint` coincide con `protectedAfter` del recibo y before=after. Es protección de la metadata definida por el SQL, **no hash de datos de clientes ni sustituto del backup**. No aprobar solo porque allTargetsOk sea true: servicio, roles, schema ACL o Storage podrían diferir.
- Hay éxito del script completo, sin respuesta incierta/no resuelta. No afirmar commit si solo se recibió el resultado anterior a COMMIT.

Si algo falla, estado **no conciliado**, conservar evidencia y detenerse. La consulta no concede autorización de corregir, reintentar o desplegar. El cierre es únicamente de PRM1; no habilita A/B/C o Composio por sí solo.

## Recuperación

Antes del COMMIT, un error revierte la transacción; limpiar la sesión solo si quedó abierta y está autorizado. Las pruebas verifican fallo intermedio e idempotencia, pero esta última **no autoriza un replay ante incertidumbre**.

Después del COMMIT, no restaurar el estado excesivo con GRANT ALL o anon/TRUNCATE, ni revertir imágenes como si revirtieran permisos. Si se demuestra una regresión, documentar objeto/rol/operación legítima, comprobar el caller/RLS, ensayar una corrección hacia adelante y solicitar su aprobación específica. Un restore integral del respaldo sería otra operación explícitamente aprobada, con impacto de datos evaluado; no una respuesta automática a un 5xx.

No borrar filas, reiniciar contadores, reasignar cuentas/marcas, rehacer importaciones o reenviar mensajes. Sin cambios de modelo, no hay backfill o tipos de aplicación que regenerar para este incremento.
