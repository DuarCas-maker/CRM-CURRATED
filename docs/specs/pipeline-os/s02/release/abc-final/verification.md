# Verificación SQL final A/B/C — preparación local

**AF-EOL-r1 vigente:** [6 nuevas y39 de regresión correctas](line-endings/verification.md), TypeScript/CLIplan/bindings correctos. Se prueba049 LF/CRLF y postflight cruzado; se conservan abortos y se rechazan cambios reales. Artefactos preparados actualizados; evidencia remota histórica preservada,0 nuevas consultas del agente. NativePG15 no ejecutado, Instantly43/0 nuevas. Las constancias siguientes mantienen su revisión original.

**PG-EXEC-r1 posterior:** [verificación del controlador/adaptador](pg15-rehearsal/executor-verification.md),12/12 pruebas nuevas offline, TypeScript y CLIplan correctos. Motor15 real no instalado/arrancado; nativeTestsExecuted=0. Artefactos049/048/pre/post/contratos,100 fuentes y49 hashes operativos conservados, Instantly43. Se comprueba el soporte nuevo en memoria, sin declarar superado PG15/locks/restore nativos.

**04/11/2026 — AF-PG15-r1 preparado:** [preflight real conforme](preflight/result-review.json), una lectura del operador ya consumida y0 nuevas del agente. [Protocolo/casos de ensayo PG15](pg15-rehearsal/README.md) y [verificación de preparación](pg15-rehearsal/verification.md); hoy solo documentos/hashes/enlaces/formato/diff,0 pruebas nativas. No modificación de049/postflight/contrato, app o worker; Instantly43. El resultado nativo de aplicación/recuperación sigue pendiente; los antecedentes siguientes mantienen sus fechas.

**02/11/2026 — implementación AF-PRE-r1:** el hallazgo previo de viewHash se corrige solo en los dos comparadores anteriores al DDL. Nuevo preflight completo READ ONLY y [verificación del incremento](preflight/verification.md); contrato/postflight y100 fuentes originales conservados. La revisión que sigue es histórica; ya no describe el código vigente del comparador. No lectura real ni publicación; Instantly43.

**Revisión restante de precondiciones:** [AF-PRE-REVIEW-r1](preconditions-review.md).049/postflight/contrato coinciden por hash y no se modifican; se contrasta evidencia previa de47 funciones,14 relaciones/221 columnas y6 policies. Se identifica incompatibilidad de hash de campaign_workspace frente a VR1 PG15 aceptado, no corregida por esta revisión. Los6 hashes de expresión de policies requieren mismo contexto; metadatos/ACL/sending actuales y controles operativos siguen sin consultar. Solo JSON/hashes/enlaces/formato/diff; no tests funcionales/TypeScript/build repetidos. [Reporte y límites](preconditions-review.json), Instantly43/0 nuevas.

**Resultado AF-INV-r2 recibido:** [revisión de206 firmas](inventory-r2/result-review.md); autorización manual READ ONLY consumida una vez, agente0. Catálogo actual conforme dentro del scope. Se ejecutó solo una prueba nueva sobre pg_collation_for: firmas directas C frente a keys JSON default; el true del diagnóstico no contradice el fallo del camino JSON. Las4 pruebas anteriores y15 originales no se repiten. No SQL/contrato/cuerpos cambiados al revisar esta salida ni permiso de reintentar049.

**AF-INV-r2, posterior al intento reportado:** [defecto de comparación de inventario](inventory-r2/bugfix.md) corregido localmente.4/4 pruebas nuevas de orden/conjunto, rechazo de faltantes/adicionales, aplicación exacta y diagnóstico READ ONLY en memoria; las15 pruebas anteriores no se repitieron. [Evidencia de la revisión](inventory-r2/verification.json). No se confirmó la causa exclusiva del entorno remoto ni se autoriza replay. Los resultados y hash del paquete anterior se conservan como antecedentes de preparación.

01/11/2026 · SDD STRICT. AF-T01–04 preparados/comprobados offline; AF-T05 y publicación pendientes. [Manifiesto](manifest.json), [contrato](contract.json), [criterios](acceptance.md), [protocolo](protocol.md).

## Evidencia nueva

15/15 pruebas nuevas,0 fallidas/omitidas, Node22.23.4 + PGlite0.5.8/PostgreSQL180003 con bloqueo de red del proceso. Se aplica el archivo049 exacto en DB desechable sobre001–047 +048, con owner supabase_admin, roles/grants/defaults amplios observados reproducidos y datos ficticios. No se ejecutan pruebas contra Supabase remoto.

| AC         | Comprobación                                                                                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC01/06    | SHA del contrato incrustado, cinco fuentes originales intactas y sin marcadores de fixture en049.                                                                                                                                                                                        |
| AC02       | Actor incorrecto, exceso humano anterior a048, cuerpo de función alterado, esquema parcial y CREATE humano en public provocan aborto antes de aplicación.                                                                                                                                |
| AC02/04    | Fallo inyectado después de los cinco cuerpos revierte todo el DDL/backfill; catálogo y filas originales se comparan sin omitir el fallo. Replay posterior se rechaza sin cambios.                                                                                                        |
| AC03/04/05 | Archivo exacto aplica con defaults amplios, iguala ACL/objetos de referencia limpia y produce recibo/postflight concordantes; defaults/metadata ajena se conservan. Las filas antiguas se comparan por sus columnas originales. No nuevas marcas, asociaciones o admisiones por aplicar. |
| AC03/04    | Documento legado ficticio sin fuente acreditada mantiene access_area NULL y no se vuelve visible al seller. No se repite el piloto de adjuntos.                                                                                                                                          |
| AC03/05    | Grant humano indebido al RPC de cierre C invalida targetsOk aunque fingerprint protegido siga igual. Cambiar defaults ajenos cambia fingerprint aunque targetsOk siga true. Escritura inyectada en postflight falla25006.                                                                |
| AC03       | Superadmin con aal1 rechazado; con aal2 puede registrar/revisar marca y cuenta ficticias con RPC reales locales. Seller asignado ve su marca; usuario ajeno/anon no, y humano no ejecuta el cierre de evidencia reservado a servicio.                                                    |

Comando ejecutado:

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-reporter=spec tests/pipeline-os-abc-final-sql.test.ts
```

TypeScript completo sin emitir ni incremental correcto; formato/JSON/enlaces/diff y conservación quedan registrados en el manifiesto. No se suman las139 pruebas C3 ni42/16 PRM a estas15 ni se repiten pruebas aceptadas.

## Revisión de diferencias y límites

La derivación usa206 funciones base y291 finales:132 entradas cambiadas, de ellas47 existentes y85 nuevas. Las47 admiten las variantes crudas recibidas en PD-R1 y la de fixture, sin normalizar fuentes al ejecutar. Se excluyen constraints de catálogo NOT NULL propias de PG18; attnotnull se sigue comprobando. No se asegura por esto equivalencia completa del deparser PG15: el contrato aborta ante otra representación y necesita ensayo PG15.

Inventario de70 diferencias service_role conciliado:46 no tocadas,23 tocadas preservadas, una cerrada por B2 aceptado (queue_campaign_test); el flujo nuevo de campaña usa JWT humano/queue_brand_campaign_test. Revisado el caller en src/app/api/campaigns/route.ts y el grant fuente B2; ausencia de caller literal no se interpreta como inexistencia de uso externo. No revocación global/defaults.

Durante QA se corrigieron problemas del soporte nuevo: search_path de referencia necesario para tipos de retorno históricos no calificados, sintaxis CASE de guarda, nombres de variables PL/pgSQL ambiguos y search_path del cliente de pruebas. Se reforzó la negativa MFA para exigir error de autorización, evitando que un fallo de resolución de función contara como éxito. No se relajaron tests ni se modificó producto/candidatos aceptados. Los campos Expected del recibo evitan afirmar lectura de configuración remota.

No ejecutado: PG15 nativo, contención independiente, matriz mixta real, QA visual, Linux build, instalador/inventario048/049, SQL remoto, worker/servidor, commit/push/deploy o bootstrap real. Las25 raíces de lock no son un inventario completo de locks implícitos. No se verificaron backup, ventana, exclusión DDL o destino actual por preparar el SQL. No se declara autorización/publicación completada.

La revisión final añadió un test y una guarda de release para intentos sending: aborto previo al DDL, mismo estado/Message-ID conservados. Resultado final15/15; no sustituye el control del worker ni autoriza conciliar o reanudar intentos reales.

La carpeta final y dos archivos de soporte/tests nuevos son el delta técnico. Los cinco candidatos,100 fuentes A/B/C,47 migraciones,048/postflight previo,49 hashes operativos, fuentes de producto/worker/dependencias y HEAD/índice se preservan; continuidades documentales propias se actualizan. Instantly43/0 nuevas, Gmail directo conservado, Composio deshabilitado;0 proveedores/env/envíos/remoto.
