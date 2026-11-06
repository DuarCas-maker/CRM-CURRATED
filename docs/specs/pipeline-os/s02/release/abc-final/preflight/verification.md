# Verificación AF-PRE-r1

02/11/2026 · SDD STRICT · [Requisitos, diseño, tareas y protocolo](spec.md), [reporte de conservación](verification.json). **Implementado y probado offline; no aplicado ni listo para publicar049.**

## Resultado comprobado

- PRE-FR01/AC01: solo dos bloques anteriores al DDL admiten los hashes PG18/PG15 de campaign_workspace ya aceptados. Todas las demás columnas/opciones/permisos y el modo final permanecen exactos. Hash desconocido/null, cambios de otros atributos, otra vista y modo final son rechazados. La prueba usa JSON de metadata simulado para la variante PG15; no se presenta como ejecución nativa PG15.
- PRE-FR02/03/AC02/03: el preflight exacto pasa con la base sintética posterior a048; cubre47 funciones existentes,14 relaciones/221 columnas, seis policies, los objetos que deben faltar y ACL048. Detecta rol faltante/membresías, ACL humana de tabla/columna, PUBLIC de columna, opción de otorgar EXECUTE, configuración/fuente y cada una de las seis policies. Políticas y metadata se comparan bajo pg_catalog,pg_temp sin normalización de expresiones.
- PRE-FR04/AC04: sending bloquea; queued/uncertain requieren revisión operativa. Se conservan estado, intentos, IDs y filas ficticias. Una forma de tabla inesperada produce queue=null/checks falsos, nunca un falso «cero sending». Solo se devuelven agregados fijos, no destinatarios, cuerpos, sujetos o registros de clientes.
- PRE-FR05/AC05: generación determinista desde049/contrato vinculados; generador rechaza guarda vieja/vínculo inválido. READ ONLY rechaza una escritura inyectada; metadata y filas permanecen iguales. Actor incorrecto retorna complete=false/preconditionsOk=false; reporte acotado a200 diferencias conserva el total y nunca aprueba un resultado truncado con diferencias. No se capturan errores SQL como éxito.
- PRE-FR06/AC06: [conservación auditada](verification.json),100 fuentes A/B/C y47 migraciones sin cambios,048/postflight/contrato final intactos,49 hashes operativos conservados, HEAD/índice sin cambios. App/worker/dependencias intactos; Gmail directo activo y Composio deshabilitado por alcance conservado, sin lectura de flags remotos. Instantly43/0 nuevas.

## Checks ejecutados

Node22.23.4, PGlite0.5.8/PG180003 en memoria, con preload offline que bloquea red. No worker/servidor/instalación. **12/12 pruebas nuevas** correctas y **15/15 de regresión de049** correctas:27 casos distintos, sin sumar ejecuciones repetidas. La regresión se justifica por el cambio de las guardas de049; no se repiten pilotos aceptados de proveedores/importación/adjuntos,048/VR1 o el inventario dedicado remoto.

```powershell
# Primera ejecución conjunta: 11 nuevas + 15 de049 = 26/26.
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-abc-preflight.test.ts tests/pipeline-os-abc-final-sql.test.ts
# Tras añadir el caso de rol faltante y la validación del vínculo del generador:
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-abc-preflight.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
```

TypeScript correcto; Prettier/JSON/enlaces, diff y conservación registrados en el reporte. Primera ejecución inicial:9/10, un fallo de fixture por reutilizar un parámetro UUID como texto; se corrigió usando un parámetro separado y la batería posterior pasó completa. No se cambió el diagnóstico para ocultarlo ni se omitieron tests.

Revisión local de código con safe-code-review: whitelist limitada, nulls/presencia, fuentes crudas, orden del inventario, grant option/PUBLIC, salida sin datos, transacción READ ONLY/ROLLBACK y límites del snapshot. Sin hallazgos bloqueantes adicionales confirmados en este delta. Esta revisión no acredita infraestructura real ni el catálogo actual.

## Pendientes y siguiente paso

No ejecutado: el preflight en Supabase real,049/contrato final en PG15 aislado, contención física independiente, matriz web/worker, visual/build Linux, instalador/versionado048/049, backup/cutover/controles operativos o publicación. No se crean hashes finales PG15 sin prueba ni se cambian otras comparaciones para forzar una aprobación.

Siguiente paso propuesto: una ejecución manual autorizada del [preflight.sql](preflight.sql), solo lectura en el Supabase self-hosted correcto del CRM, con el [protocolo](spec.md). **Una lectura, cero reintentos, cero peticiones de Instantly.** Hoy no está autorizada ni ejecutada. No aplicar049 ni repetir048/VR1/inventario dedicado; publicationReady=false permanece incluso con preconditionsOk=true.
