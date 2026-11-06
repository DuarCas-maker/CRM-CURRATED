# Verificación local — AF-FDIAG-r1

04/11/2026 · SDD STRICT · [FR/AC/diseño](spec.md), [protocolo](README.md), [reporte de preservación](verification.json), [hashes](manifest.json).

## Resultado

**Seis casos distintos correctos; TypeScript correcto.** Motor sintético PGlite 0.5.8 / PostgreSQL 18 en memoria, con el preload que bloquea la red. Cero ejecución nativa en PostgreSQL 15. No se repitieron pilotos aceptados, llamadas reales ni la batería anterior de 45 casos: los archivos de aquella revisión permanecen intactos.

| Caso          | Evidencia                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FD-AC01/02    | Generación determinista, rechazo de entradas alteradas, reversión exacta de las tres sustituciones a 049 sellado y prefijo DDL idéntico.                                              |
| FD-AC04/05    | Ejecución completa LF y CRLF termina en rollback; recibo diagnóstico distinto del recibo de aplicación. Catálogo y hashes de filas sintéticas de contactos/cuentas/perfiles iguales.  |
| FD-AC02/03/05 | Mutaciones sintéticas de código, EXECUTE, opción de vista y columna reportan exactamente objeto/campo; no exponen el valor sintético original. Tras limpieza, catálogo/filas iguales. |
| FD-AC02/03    | 25 funciones adicionales generan fallo de inventario, total 25, lista limitada a 20 y truncamiento explícito.                                                                         |
| FD-AC03/05    | Más de 40 diferencias de configuración conservan el total y el fallo, con 40 detalles máximos.                                                                                        |
| FD-AC02       | Actor incorrecto conserva `ABC_CONTEXT_MISMATCH`; cambio de configuración protegida conserva `ABC_PROTECTED_METADATA_CHANGED`. No se capturan ni silencian.                           |

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx scripts/pipeline-os/prepare-abc-final-diagnostic.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-abc-final-diagnostic.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
```

La suite completa pasó 6/6. Se amplió después el sexto caso con la negativa de huella protegida y se ejecutó ese caso de nuevo: correcto. No se suman los intentos repetidos al total. El formateo posterior no cambia el comportamiento SQL.

## Hallazgos resueltos durante QA del diagnóstico

El primer intento de reporte usó `current_setting('lc_collate')`, que el motor sintético no ofrece: error reproducido `42704`. Se sustituyó por lectura de `pg_database.datcollate`, sin emitir el nombre de la base. Otro fallo era del test: la mutación de longitud correspondía a `brand_b1.ref(text)`, no a `composio_c1.mask(text)`; se corrigió la aserción conforme a la fuente. No se consideran causas del fallo productivo original.

Revisión local con safe-code-review: entrada sellada, reversión exacta a la fuente, todos los atributos y errores previos conservados, reporte sin valores originales, límites independientes con totales, ninguna ruta terminal de COMMIT, cleanup explícito en clientes que detienen el lote. No se agregan nuevos hashes admitidos ni se cambia el contrato de aplicación.

## Preservación y límites

La auditoría compara todos los archivos públicos existentes con el inventario anterior a este incremento; no se modifica ninguno. También verifica los 49 hashes operativos existentes sin abrir env reales, las 47 migraciones, la revisión preparada de 048/049, HEAD y el índice. Las adiciones quedan enumeradas en el manifiesto separado.

Instantly permanece en 43 consumidas y 0 nuevas. Producto, Gmail directo, configuración de Composio, dependencias y worker sin cambios; no se consultaron flags remotos. Cero SQL remoto, API, envíos, instalaciones, servidores nativos, push o despliegue.

La confirmación A del operador se conserva como evidencia del nuevo intento; no certifica hash del texto enviado, timestamp ni estado remoto posterior. No se ejecutó nueva limpieza/preflight remoto. **La causa exacta sigue sin confirmarse.** Falta reproducción nativa y evidencia de las diferencias del intento. La preparación de este diagnóstico no da autorización remota ni cierra los controles de publicación.
