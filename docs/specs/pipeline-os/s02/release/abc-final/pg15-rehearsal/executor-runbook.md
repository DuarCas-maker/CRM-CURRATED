# Uso del ejecutor — PG-EXEC-r1

**AF-EOL-r1:** las entradas/pins vigentes incorporan la [corrección LF/CRLF](../line-endings/verification.md). Las huellas del manifiesto actual sustituyen solo los artefactos preparados; las evidencias anteriores conservan sus hashes históricos. --plan vuelve a pasar con la revisión actual y sigue sin ejecutar procesos PostgreSQL.

Implementado y probado offline04/11/2026. [Contrato](executor-spec.md), [evidencia](executor-verification.md). El modo predeterminado solo revisa archivos y muestra el plan:

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx scripts/pipeline-os/pg15/cli.ts --plan
```

Se comprobó fixtureSteps=52, plannedCases=16, nativeTestsExecuted=0 y processStarts=0. No requiere PostgreSQL, credenciales, conexión o instalación. No hay comandos de descarga/initdb/pg_ctl start en el ejecutor.

## Requisitos para una ejecución nativa posterior

La preparación del motor/cluster sigue en PG-T02 y no fue realizada. El ejecutor espera dos clusters exclusivos ya provisionados: principal y recuperación, en127.0.0.1:55449/55450, con misma versión15.x declarada, roles de aplicación inicialmente ausentes, datos bajo .local/pipeline-os/pg15-049/<run-id>/<primary|recovery>/data y sin consumidores del CRM. No se usa una base existente del CRM o de otro proyecto.

Cada cluster necesita cluster.json (protocol=AF-PG15-CLUSTER-r1, runId, systemIdentifier, dataDirectory) y archivo pgpass efímero privado. El servidor debe escuchar solo127.0.0.1; pg_hba permite SCRAM desde127.0.0.1/32 y, opcionalmente, reglas reject. Otras aperturas/métodos o diferencia de directorio/ID/versión/puerto causan rechazo antes del DDL. No confiar en que un puerto local demuestra aislamiento.

Configuración validada por [configSchema](../../../../../../../scripts/pipeline-os/pg15/types.ts): protocol, runId hexadecimal24, approvedLocalRun=true, stopOwnedClusters, runtimeRoot privado, runtimeVersion15.x, hashes SHA256 de psql/pg_dump/pg_restore/pg_ctl, y por cluster systemIdentifier/dataDirectory/marker/passfile. Sin campos libres de host/DSN, variables de proveedor o SQL. No se genera hoy un manifiesto aprobado ni se copia una contraseña/cookie.

El CLI solo admite una configuración llamada execution.json bajo el directorio de ese run-id, con autorización local futura específica. El modo que ejecuta es --execute-local más ese archivo; **no se ejecutó ni está autorizado por esta entrega offline**. Nunca pasarle un .env/URL, añadir --single-transaction, cambiar hashes/roles para saltar un fallo o sustituir los SQL exactos. Resolver antes disponibilidad/procedencia/licencia del runtime y alcance de provisión/parada de los dos clusters.

## Qué hará al ejecutarse bajo ese alcance

1. Verificar58 entradas selladas y cinco fuentes aceptadas; ejecutables/versiones/realpaths/marcadores. El entorno de procesos contiene solo sistema mínimo y los parámetros efímeros del ensayo; -X/ON_ERROR_STOP, sin shell/rc/prompts ni echo de SQL.
2. Identificar ambos servidores desde sesiones READ ONLY; rechazar clusters no frescos. Crear roles sintéticos, base/plantilla y clones propios. Inicializar001–047 +048 exactos y fixtures, sin tocar archivos originales o el CRM real.
3. Ejecutar los16 casos en orden, con parada de nuevos casos ante el primer fallo.049 y postflight exactos, código de salida/recibos/huellas concordantes y backend diferente para postflight. El fallo tardío usa solo una copia inyectada en memoria, claramente distinguida del caso positivo.
4. Coordinar locks con sesiones A/B/C y esperar evidencia de bloqueo real; no dar pass por una espera serial. Dump/restore entre los dos clusters propios, archivos base.dump/final.dump nuevos, huellas comprobadas; no sobrescribir archivos existentes. Conservar límites de DDL concurrente y probes de contrato frente a imágenes reales.
5. Cerrar canales y detener clusters propios únicamente si stopOwnedClusters está aprobado, se llegó a mutar y sus identidades se reconfirman. report.json se escribe sin sobrescribir otro. Si falla antes de tocar la base, no se para ningún cluster. Si no se confirmó la parada, finished=false. No borra bases/directorios o evidencia automáticamente.

No hay retry automático. Bases/archivos existentes, lock no observado, timeout, código no cero, recibo ausente/duplicado, drift de recuperación o apagado no confirmado producen fail/blocked; revisar ese reporte antes de otro run-id. La limpieza manual posterior necesita delimitar el directorio exacto, no usar reset/clean o borrado global.

Un resultado simulated nunca es evidencia PG15. Incluso un native/finished=true mantiene publicationReady=false hasta cerrar los demás controles de publicación. La huella de filas se calcula sobre las columnas originales; se comprueban por separado access_area derivada de fuente ficticia y legado desconocidoNULL. No envío, proveedor, verificación paga o reanudación del legado por pasar el ensayo.
