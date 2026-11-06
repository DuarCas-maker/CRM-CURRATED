# Verificación offline del ejecutor — PG-EXEC-r1

04/11/2026 · SDD STRICT · EX-T01–04 implementadas/verificadas. [Requisitos](executor-spec.md), [uso](executor-runbook.md), [reporte/hashes](executor-verification.json). **Ejecutor implementado; ensayo nativo pendiente.**

## Evidencia nueva

**12/12 tests nuevos correctos**, cero omitidos. Un caso recorre los16 escenarios con un Engine simulado; no se suman como16 tests nativos. El transporte se prueba con streams/procesos simulados, incluidos timeout/error y versiones incorrectas. El SQL de soporte nuevo se comprueba además en PGlite18 en memoria con fuentes reales001–049 y filas ficticias; tampoco equivale aPG15 nativo. No se ejecutan PostgreSQL/psql reales, worker, servidor web o proveedores.

| AC      | Evidencia                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EX-AC01 | Rechazo previo por aprobación/campos/host implícito/rutas fuera del run-id, cluster compartido, versión mayor/menor, directorio/ID/DB/marcador o exposición de red. Hash/versiones de binarios ficticios y realpaths; cero arranques de procesos reales.     |
| EX-AC02 | Bundle58 entradas y cinco candidatos por hash, inventario47, cuerpos/048/049/pre/post sin cambios. Fixture52 etapas, roles explícitos por sesión, sin MAINTAIN en el camino nativo. TestPG18 aplica solo un shim MAINTAIN declarado en su scaffolding.       |
| EX-AC03 | -X/ON_ERROR_STOP/no shell/prompts/variables heredadas, parser de cabeceras conocidas, stderr sanitizado, frames divididos, sesión ocupada, timeout y cierre dirigido. Código no cero aun con recibo, duplicados o postflight inválido fallan.                |
| EX-AC04 | Coordinación de16 AC, clones/parada ante fallo, roles/MFA, replay, copia inyectada, observación de locks, dos backups/restores y probes legacy. Falta de espera observada o restore alterado no puede aprobar. Stop ausente/fallido mantiene finished=false. |
| EX-AC05 | Fixture/snapshot SQL y pruebas RPC/RLS/MFA del controlador contra DB en memoria, comparación de todas las filas por columnas originales, legacyNULL y backfill seller desde fuente ficticia con elección de adjunto incluida. No se deshabilita esa guarda.  |
| EX-AC06 | Conservación auditada en reporte;100 fuentes,47 migraciones,048/049/contrato/preflight/postflight,49 hashes operativos y HEAD/índice. App/worker/dependencias intactos, Instantly43/0 nuevas, directo y Composio deshabilitado.                              |

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-pg15-executor.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
```

TypeScript correcto. CLI --plan comprobado sin subprocess/SQL real; ver [runbook](executor-runbook.md). Formato, JSON, enlaces, diff, hashes de entradas y preservación registrados en el reporte. No se repiten las baterías/pilotos de proveedores, importación, recepción/adjuntos o la lectura remota aceptada. La ejecución en memoria de los artefactos se justifica por comprobar el adaptador nuevo, no se suma a las pruebas previas.

## Hallazgos corregidos durante QA/revisión

La primera pasada tuvo9/12: el modelo simulado interpretaba definiciones de funciones como inserts reales, y el test de soporte no restablecía el actor antes de la migración. También se corrigieron tipos del entorno/streams. No se ajustó049 para ocultar esos fallos. La revisión del camino por procesos confirmó que no puede heredarse SET ROLE entre sesiones: el fixture nuevo ahora lo fija explícitamente para defaults/048 y el test resetea el actor entre etapas.

Al añadir la fuente ficticia para cubrir el backfill se activó Attachment selection required; se añadió la elección ficticia incluida correspondiente, conservando el trigger. La batería final12/12 incluye ese caso y preservación de filas; ninguna guarda ni test se omite. Los placeholders de binarios son textos no ejecutables en un directorio temporal exclusivo de tests, retirado con su ruta verificada; no constituyen instalación de PostgreSQL.

Revisión safe-code-review del delta: actor/destino, separación de procesos, recibos/exit codes, rollback, cleanup de sesiones, bloqueo observado, archivo existente/restore y salida sin datos. No quedan hallazgos bloqueantes confirmados en el alcance offline. No se afirma auditada/validada la semántica del motorPG15, pg_dump/restore reales, libpq/Windows real, locks físicos o paridad de OS/collation: siguen pendientes del ensayo nativo.

## Estado y siguiente paso

PG-T03 completo offline. PG-T02 falta: adquirir/proveer runtime15 y dos clusters privados con marcadores/credenciales efímeras, sin usar elCRM. PG-T04/05 nativos pendientes; visual/build/compatibilidad de imágenes/instalador/cutover/producción siguen abiertos. Siguiente paso: preparar la habilitación local del motor conforme al contrato del ejecutor; sin SQL remoto o nuevas llamadas de proveedor.

Hoy: **0 pruebas nativas,0 procesos PostgreSQL reales,0 instalaciones/descargas,0 APIs/envíos/remoto/push/deploy**. Gmail directo activo preservado, Composio deshabilitado y43 peticiones de Instantly. No se reutiliza la autorización de la lectura real anterior.
