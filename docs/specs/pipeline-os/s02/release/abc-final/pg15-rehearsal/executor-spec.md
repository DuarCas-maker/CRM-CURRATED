# PG-EXEC-r1 — implementación del ejecutor offline

04/11/2026 · SDD STRICT · Implementación PG-T03 autorizada. Se mantienen FR01–06 y los16 casos del protocolo. Clarificación cerrada: procesos/SQL y resultados simulados hoy, sin instalar/arrancar PostgreSQL o consultar servidores. Runtime y credenciales efímeras del ensayo serán provistos por PG-T02; el ejecutor no descarga, instala o inicia clusters.

## Entendimiento y diseño confirmado

Implementar carga verificable de artefactos, adaptación del fixture a SQL nativo, transporte psql inyectable y orquestación de aplicación/postflight/casos. El CLI prepara el plan por defecto; ejecución local futura requiere flag explícito y manifiesto privado con aprobación de ese ensayo, dos clusters privados preaprovisionados (principal/restauración) y binarios15.x verificados. No se genera ese manifiesto autorizado hoy. Configuración/DSN libre, entornos heredados de proveedor y destinos no acreditados se rechazan.

Los casos usan clones propios; roles negativos se restauran antes del siguiente caso. Las sesiones persistentes permiten barreras reales de lock y PIDs distintos; el modo simulado ejercita la coordinación sin certificar contención física. Dump/restore solo entre ambos clusters del ensayo y archivos propios verificados. Se cierra el transporte siempre; detener clusters ya provistos solo si el manifiesto autoriza esa operación y sus identidades se reconfirman. No borrado automático de datos/evidencia ni pg_ctl start/initdb.

## AC de implementación

| ID      | Resultado requerido                                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EX-AC01 | Validación estricta de aprobación, run-id, host/puertos fijos, rutas privadas, marcadores, versión/hash de binarios e identidad realpath/data_directory/system_identifier. Cero mutaciones ante fallo.                |
| EX-AC02 | Bundle exacto58 entradas:001–047/048/049/postflight/contrato/preflight y soporte de referencia; fixture nativo sin MAINTAIN ni PGlite importado en runtime. Migraciones originales intactas.                          |
| EX-AC03 | psql sin shell/rc/prompts/entorno externo; canales con plazo/salida limitada; errores sanitizados y cierre dirigido. Recibo sin código cero o postflight divergente nunca aprueba.                                    |
| EX-AC04 | Orquestación de los16 AC con resultados pass/fail/blocked, fail-fast de integridad/destino, negativos explícitos y conservación. Simulación etiquetada, nativeTestsExecuted=0/publicationReady=false.                 |
| EX-AC05 | Pruebas adversas offline, incluida coordinación de sesiones, fallo/timeout/recibo incompleto, preservación y restore. Probar además el SQL de soporte nuevo en memoria donde sea útil, sin repetir pilotos aceptados. |
| EX-AC06 | Conservar100 fuentes,47 migraciones/048/049/contrato/postflight/preflight,49 hashes operativos, HEAD/índice y dependencias. Instantly43/0 nuevas, directo activo y Composio deshabilitado.                            |

Tareas: EX-T01 guardas/bundle/fixture; EX-T02 transporte/ejecutor/CLI; EX-T03 casos y tests offline; EX-T04 revisión, evidencia y continuidad. Rollback local mediante diff de estos archivos nuevos y documentos propios; no reset/revert global ni cambios remotos. Gates PG15 nativo/recuperación/binarios/producción siguen abiertos hasta ejecutar y revisar su evidencia real.
