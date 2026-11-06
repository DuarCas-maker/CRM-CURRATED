# Verificación AF-EOL-r1

04/11/2026 · SDD STRICT · [Alcance/diseño/AC](spec.md), [pares de huellas](source-variants.json), [incidente y lectura recibida](incident.json), [reporte/hashes](verification.json). **Corregido y probado offline; sin aplicación remota.**

## Resultado y límites

La misma049 ahora pasa enLF yCRLF en DB desechable; ambos postflight (LF/CRLF) concuerdan con sus recibos, sin omitir final check, huella protegida, ACL o READ ONLY. El snapshot conserva MD5 crudo;117 firmas usan dos huellas finales explícitas y otras2 firmas reemitidas usan una proyección explícita de esas huellas al formar la huella protegida. Todo otro atributo y todo hash desconocido sigue comparándose. Se examinaron las119 fuentes:0 literales/identificadores citados multilínea, por lo que no se flexibiliza contenido textual de literales.

Cambios de lógica (120→119), literal de máscara, mezcla parcial de EOL dentro de un cuerpo o configuración producen rechazo y rollback. Cambiar fuente/configuración en las dos funciones protegidas también mantiene la guarda: se observa ABC_PROTECTED_METADATA_CHANGED o huella postflight distinta. La prueba reconstruye por reversión controlada los hashes exactos de049/postflight/contrato anteriores y regenera determinísticamente la revisión actual. Cinco cuerposDDL/candidatos y reglas de producto sin cambios.

El fallo productivo fue anterior alCOMMIT y la lectura posterior volvió a cumplir el catálogo previo. Se conserva esa evidencia con sus hashes antiguos; no se reescribe para atribuirla a esta revisión. No se atribuye exclusivamente el fallo remoto aCRLF sin disponer de la entrada exacta. Tampoco se afirma QA nativoPG15, volumen, worker detenido o validación de nuevas vistas PG15 por esta prueba de formato.

## Pruebas ejecutadas

**6/6 nuevas +39/39 de regresión =45 casos distintos correctos**, sin omitidos:

- 6 EOL: derivación/lexer, reconstrucción exacta, aplicación LF/CRLF con postflight cruzado y negativas de código/literal/EOL mixto/configuración/metadata protegida.
- 15 de 049: contrato/fuentes, contexto/sending/ACL, estado parcial, rollback tardío, aplicación/huellas, replay, roles/MFA y READ ONLY.
- 12 de preflight: reproducción determinista, metadata/policies/ACL/cola, fallos cerrados y preservación.
- 12 del ejecutor: bindings nuevos, procesos simulados, 16 escenarios simulados y SQL de soporte en memoria. No son 16 pruebas nativas.

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-abc-line-endings.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-concurrency=1 tests/pipeline-os-abc-final-sql.test.ts tests/pipeline-os-abc-preflight.test.ts tests/pipeline-os-pg15-executor.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
```

TypeScript correcto; CLI --plan correcto con52 etapas/16 casos/0 procesos nativos y nuevos vínculos. Formato, JSON, enlaces, hashes/diff y preservación registrados en el reporte. Se justifica esta regresión por cambiar artefactos/comparadores/bindings; no se repiten pilotos reales aceptados o lecturas remotas.

## Hallazgos durante QA

La primera corrección de117 huellas reveló dos rutinas reemitidas iguales enLF que no estaban en el delta lógico: campaign_contact_summary y campaign_contacts_page. Se reprodujo y corrigió su tratamiento dentro de la huella protegida, sin retirar la comparación ni ampliar el delta de producto. Pruebas adversas comprueban que no se acepta fuente/configuración arbitraria allí.

También se detectó que el archivo preflight había vuelto exactamente a su hash anterior04c0… después de su primera regeneración. No se atribuye autor/causa; no se sobrescribió una versión desconocida. Se verificó el hash conocido y se regeneró desde los artefactos vigentes, reseñando sus bindings. La batería posterior39/39 y CLI volvieron a pasar. Los manifiestos finales verifican que permanece vinculada la revisión correcta. No se relajó QA_INPUT_HASH para resolverlo.

Revisión local con safe-code-review: whitelist por firma y modo, lexer sin modificación de datos, guards de presencia/atributos, preservación de metadata no admitida, reverse exacto y archivo sellado. Sin otros hallazgos bloqueantes confirmados dentro de este alcance offline. Falta el ensayo nativo15 y demás controles de publicación, mantenidos abiertos.

## Preservación y siguiente paso

100 fuentes aceptadas,47 migraciones,048 y49 hashes operativos sin cambios; HEAD/índice conservados. Solo se actualizan049/postflight/contrato/preflight preparados, referencias del ejecutor y su fixture de procesos simulado, más el soporte/tests/documentos de esta corrección. No producto/worker, dependencias, flags/credenciales o SQL remoto.

Instantly43/0 nuevas, Gmail directo activo conservado y Composio deshabilitado;0 APIs, envíos, instalaciones, servidores PostgreSQL, push/deploy o cambios remotos. Los nuevos hashes sustituyen únicamente la revisión preparada, no la evidencia histórica. Siguiente: ensayar la revisión sellada enPG15 aislado y cerrar controles de publicación antes de cualquier nueva aplicación real; esta entrega no concede ese permiso.
