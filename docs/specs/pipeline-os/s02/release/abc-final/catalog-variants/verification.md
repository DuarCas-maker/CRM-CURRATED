# Verificación AF-CVAR-r1

SDD STRICT. [Requisitos y diseño](spec.md), [definiciones y linaje](evidence.json), [auditoría](verification.json), [hashes vigentes](manifest.json).

## Resultado y causa

El diagnóstico remoto recibido estaba vinculado a 049 `19548594…` y contrato `6fc8d3de…`. Reportó exactamente 14 diferencias, sin truncamiento ni cambios en el inventario. Se cotejaron las 14 huellas de campo: nueve con fuentes ya admitidas del contrato previo, cinco con definiciones completas reconstruidas desde las vistas de referencia. No se admitieron hashes desconocidos por el hecho de aparecer en el resultado.

Las nueve fuentes se conservan bajo su firma o se renombran mediante los cuatro ALTER FUNCTION verificados en los cuerpos inmutables. Se añade su linaje al contrato final. Las cinco vistas se comparaban por un texto de deparser que omitía calificadores que sí aparecen en la evidencia recibida. Cada variante nueva se derivó primero del SQL conocido y coincidió exactamente con la huella recibida. No se normalizan consultas arbitrarias ni se quitan columnas, expresiones o permisos de la comparación.

## Pruebas

**5 casos nuevos + 51 de regresión = 56 casos distintos correctos; TypeScript correcto.**

- CV-AC01/03: procedencia de las 14 variantes, generación determinista y reversión byte a byte de 049/postflight/contrato a la revisión anterior. Mismo conjunto changed y fórmula protegida.
- CV-AC02/04: las diez definiciones de las cinco vistas se analizan en PGlite y cada par vuelve al mismo SQL canónico. Se comparan ambos roundtrips: una vista de origen guardaba la lista del tipo compuesto antes de añadir columnas posteriores a outbox; recrearla ve el tipo ampliado, sin cambiar su SELECT. Esta diferencia de RTE hizo fallar inicialmente una aserción que se corrigió para comparar las dos entradas bajo el mismo catálogo.
- CV-AC01/02/04: nueve fuentes base CRLF aceptadas y simulación explícita de las cinco representaciones observadas reproducen las 14 diferencias del diagnóstico anterior, incluido cada observedFingerprint. La revisión nueva aplica en LF y CRLF y sus postflight (representación canónica y observada) concuerdan con la huella protegida.
- CV-AC02/04: fuentes desconocidas, cambio de lógica de vista, security_invoker y EXECUTE adicional siguen fallando; rollback deja el catálogo igual.
- CV-AC02/04: cambiar columnas de vista se rechaza; las variantes finales no satisfacen ni omiten una precondición alterada.

Los cuatro casos restantes pasaron en la suite inicial y el caso de roundtrip ajustado se volvió a ejecutar correctamente. No se suman intentos repetidos. Regresión completa 51/51: migración vigente 15, preflight vigente 12, ejecutor con bindings vigentes 12, EOL histórico 6 y diagnóstico histórico 6. Los dos últimos reconstruyen su revisión anterior con comprobación de hashes y conservan todas sus aserciones; no se les atribuye validación de una revisión distinta.

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-abc-catalog-variants.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-concurrency=1 tests/pipeline-os-abc-final-sql.test.ts tests/pipeline-os-abc-preflight.test.ts tests/pipeline-os-pg15-executor.test.ts tests/pipeline-os-abc-line-endings.test.ts tests/pipeline-os-abc-final-diagnostic.test.ts
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
```

El motor sigue siendo PGlite 0.5.8 / PG18 en memoria. La representación de vistas observada en PG15 se simula explícitamente en las copias de observación de los tests; esto no equivale a ejecutar PostgreSQL 15 nativo, locks físicos ni dump/restore. Se conservan abiertos esos controles y los de publicación. No se repiten pilotos reales aceptados.

## Preservación y operación

Los cuerpos de los cinco SQL y las fuentes de producto no cambian. 47 migraciones, 048, 100 fuentes del payload, 49 hashes operativos, HEAD e índice conservados. Instantly 43/0 nuevas; Gmail directo activo y Composio deshabilitado conservados sin consultar flags remotos. Cero APIs, SQL remoto, envíos, instalaciones, push o despliegue del agente.

El archivo diagnóstico que produjo el resultado conserva el hash `a2de4362…`; su reporte histórico no se reescribe. Su manifiesto de bindings conserva copia exacta de la versión previa al reseñar los cambios transparentes del generador/test histórico. La autorización de un intento de diagnóstico está consumida; la limpieza final indicada no tiene confirmación recibida. El operador confirmó pausa y decidió seguir sin respaldo. No se certifica recuperación ni instalación por esa decisión.

La nueva 049 termina en COMMIT y su postflight es READ ONLY con ROLLBACK. Ninguno se ha ejecutado en el CRM por esta revisión. Los recibos futuros deben indicar contrato `e9b0928a431e8bb8106d8004d42b057ae3d66607d21050c25dc4804d4e36083c`; no sirven los hashes del diagnóstico anterior. Tras aplicar completo, revisar Success y JSON, y después el postflight con rolesOk/targetsOk y huella igual a protectedAfter. No publicar binarios ni reanudar servicios como parte implícita de estos pasos.
