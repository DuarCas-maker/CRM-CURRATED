# PD-R1 — implementación y QA offline

Evidencia posterior: [PD-R1 recibido desde PostgreSQL15.8](result-review.md) y [CR-001](changes/CR-001-real-readonly-validation.md) sustituyen la exigencia de montar un motor aislado solo para compatibilidad de esta consulta. Las32 pruebas y los límites descritos abajo conservan su alcance offline histórico; no se presentan como pruebas de escritura en producción o aprobación de A/B/C.

01/11/2026 · SDD STRICT · [Ventana de implementación](implementation-design.md), [protocolo](README.md), [SQL generado](diagnostic.sql), [scope](scope.json), [referencia sintética](local-reference.json). Las evidencias de preparación anteriores se conservan como historia, no se editan para aparentar una ejecución remota.

## Resultado

PD-T03 implementada en un módulo/CLI local, un fixture y un test nuevos, más SQL/artefactos propios. No código de aplicación, cliente API, env, dependencia nueva o migración. El CLI solo admite `--render` y `--compare referencia.json resultado.json`: no tiene `--execute`, transportes, login o reintentos. Los errores son fijos, sin imprimir entradas inválidas ni rutas/credenciales.

El SQL conserva READ ONLY/timeout15s/lock2s/search_path=pg_catalog y ROLLBACK, sin RPCs/filas de negocio. Scope firmado por huella:30 relaciones ACL,206 funciones (77 con ACL de origen),93 relaciones para columnas/constraints, ocho policies y tres vistas. Roles no estándar se seudonimizan por hash; cuerpos SQL, expresiones, defaults y configuración se entregan solo como hashes. Los owners y grants efectivos no se ocultan al normalizar representación. La salida siempre requiere revisión humana y nunca aprueba publicación o identidad del destino.

La referencia local contiene datos de catálogo sintéticos, sin perfiles/clientes reales. Un catálogo viejo no entra en este contrato nuevo; no se transforma la instantánea anterior en evidencia PD-R1. La consulta real sigue pendiente.

## Checks ejecutados

Comandos en el workspace local, con Node22.23.4 y preload offline, sin env:

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-reporter=dot tests/pipeline-os-catalog-permissions.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit --incremental false
```

**32/32 pruebas nuevas correctas, TypeScript correcto.** La auditoría final registra formato/enlaces/hashes/archivos en implementation-manifest.json. No se suman las139 pruebas heredadas ni se reejecutan pilotos aceptados.

| FR / AC        | Evidencia nueva                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD-FR01 / AC01 | Cardinalidades/scopes, wrapper de Studio, orden de claves y comparación con estado explícito, sin aprobar publicación.                                                                                                       |
| PD-FR02 / AC02 | ACL directa/PUBLIC, rol heredado/NOINHERIT, owner/default, derechos de esquema y EXECUTE de helper interno detectados aunque RLS esté activo. Defaults no se declaran origen histórico probado.                              |
| PD-FR03 / AC03 | Huellas de cuerpo/config/policy/vista, literales con espacios, formato CRLF conservador, FK/orden de columnas/acciones y extras Storage. NOT NULL se consulta por columna, no por conteo PG18.                               |
| PD-FR04 / AC04 | Centinelas ficticios de secretos/literales y rol con nombre personal no aparecen en salida. Solo metadata/hashes, sin SQL de escritura/RPC/lectura de filas en el script.                                                    |
| PD-FR05 / AC05 | Repetición estable, escritura inyectada rechazada por READ ONLY en fixture, profundidad8 en SQL, extras/faltantes/duplicados, contexto/inventario incompleto, tamaño2MiB e inputs inválidos rechazados. CLI sin execute/env. |
| PD-FR06 / AC06 | Fixture recupera catálogo inicial tras cambios ficticios reversibles; auditoría de100 payload/47 migraciones/49 hashes operativos/HEAD/index y archivos ajenos.                                                              |

## Revisión y límites

Revisión propia con safe-code-review: solo el delta PD y contratos, SQL y consumidores de CLI/tests. Se corrigieron durante el desarrollo casts de tipos de catálogo, parametrización de la función falsa y restauración de security_invoker del fixture. Se endureció la comparación para conservar el orden de columnas compuestas y no explicar cuerpos distintos por normalizar CRLF. Ninguno de esos ensayos o cambios se ejecutó en remoto.

PGlite usado180003 frente al motor reportado150008. SQL revisado para columnas/APIs comunes de PG15 (`pg_auth_members` básico y pg_has_role MEMBER/USAGE); no usa inherit_option/set_option posteriores. ACL MAINTAIN de la referencia PG18 se conserva como metadata y no se consulta con has_table_privilege enPG15. Owners, permisos extra de plataforma y huellas de deparser seguirán generando hallazgos, no un PASS por coincidencia parcial.

**No ejecutado:** PostgreSQL15 independiente, porque docker/psql/postgres no están en PATH; no se instaló software ni arrancó WSL/servicios. La ejecución nativaPG15 de PD-T04 sigue abierta y se debe completar/valorar antes de pedir ejecución real. No se presenta compatibilidad nativa como probada. Tampoco build/UI/concurrencia de A/B/C, SQL final, credenciales/API, bootstrap, push/deploy o cambios Supabase/Coolify.

PD-T03 y QA offline de PD-T04 concluidos con ese límite explícito. REL-T03 y G5/G6 de promoción siguen abiertos. Instantly43/0 nuevas; Gmail directo activo y Composio deshabilitado por alcance conservado, sin comprobación remota nueva de flags. Presupuesto futuro propuesto: una ejecución manual READ ONLY, sin retry; todavía no autorizada. Rollback local: retirar solo fuentes PD nuevas/cambios documentales propios; no reset o cambios a WIP. Remoto no requiere reversa porque no se tocó.
