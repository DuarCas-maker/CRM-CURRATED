# DV-PUB-r1 — verificación de preparación

11/11/2026 · SDD STRICT · publicación no ejecutada. Reutiliza el alcance confirmado
de DV-LIMIT-UI y [protocolo de publicación](controls-publication.md).

## Trazabilidad y resultado

| T / FR / AC | Resultado observado |
| --- | --- |
| T01 / PUB01 / AC01 | HEAD2730d2731ec871e80d3393f5c48d059496d95bb2;13/13 hashes de implementación intactos; solo2 archivos versionados modificados. Índice Git vacío, sin stage/commit. Paquete explícito1083 fuentes. |
| T02 / PUB02 / AC02 | Revisión en modo revisión con safe-code-review: autorización humana/MFA/cuenta antes del descriptor/servicio; DTO estricto, Origin, cuerpo8192, presupuesto4, TTL10min, CAS/replay, saneamiento de errores y bloqueos UI. Sin hallazgos confirmados pendientes en ese alcance. |
| T03 / PUB03 / AC03 | Build Next16.3.8/webpack standalone Windows/Node22.23.4 código0, TypeScript completado,49 páginas estáticas y ruta nueva presente. Valores ficticios, env reales0, bloqueo de red y sin iniciar web/worker. |
| T04 / PUB04 / AC04 | Destino histórico identificado y runbook listo: flags off, mismo commit en ambos recursos,6 peticiones propuestas a la app, imágenes2730d27 como reversa a revalidar. No se revisó remoto en esta preparación. |
| T05 / PUB05 / AC05 | SQL052, producto previo, worker/Dockerfiles/manifests, Gmail directo, constante Composiofalse y WIP conservados. Instantly43,0 peticiones externas/envíos/cambios remotos/push/deploy. |

La evidencia de implementación continúa válida por coincidencia13/13 SHA256:
27/27 pruebas del paquete/regresiones,4 escenarios PG15 propios y revisión visual
ES/EN360/768/1280. No se repitieron esas pruebas aceptadas, pilotos operativos o052.
Se añadió la compilación de publicación y una comprobación nueva del handler
compilado, que eran los pendientes pertinentes de esta etapa.

## Paquete y normalización

`controls-publication-prepare.mjs --build` produjo la selección explícita a partir
de Git y de los13 paths del incremento más los documentos de este directorio.
Rechaza env reales por nombre, directorios privados, symlinks, cambios ajenos de
archivos versionados, índice ocupado, filtros Git no revisados y base distinta.
No instala dependencias ni escribe Git. WIP histórico externo a la selección intacto.

La copia y el tar contienen1083 fuentes. No incluyen .local, .git, node_modules,
env reales o resultados de compilación. Los receipts/manifiesto/verificación de
esta preparación quedan fuera de la huella del propio paquete para evitar ciclos;
se entregan como metadatos revisables separados y sí figuran en la selección del
futuro commit.

Git prescribe LF. Se guardan workingSha256, SHA256 del contenido publicable y blob
SHA1 esperado; se preservan bytes de los archivos -text/binarios. Se cotejaron los
13 blobs del delta con `git hash-object --path=… --stdin`, sin escribir objetos:
13/13 coinciden. No se amplió .gitattributes ni se cambiaron artefactos sellados.

Inventario/archivo y huellas: controls-publication-sources.json. Tar local:
`.local/pipeline-os/dv-publication/web-worker-sources.tar.gz`. No fue subido a ningún
servidor; el flujo propuesto sigue usando el repositorio existente y Coolify.

## Compilación aislada y comprobación del código compilado

Una copia nueva en `.local/pipeline-os/dv-publication/build-0VisAz` usó únicamente
dependencias existentes de este checkout mediante junction local, sin env reales,
con un entorno hijo mínimo y valores Supabase/Origin ficticios. Se ejecutaron
prepare-pdf-viewer y `next build --webpack` bajo el guard de red. Sin ejecutar
servidor, worker o pruebas de proveedor.

El primer build también compiló, pero el postcheck del empaquetador supuso
`standalone/server.js` directamente. En esta copia anidada, Next registra un
relativeAppDir debido al tracing root. Se corrigió únicamente el empaquetador
documental para usar ese metadato validando su confinamiento y se volvió a sellar
y compilar: código0, ruta presente y entrada standalone existente. Ningún cambio
de producto, configuración Next o Dockerfile para resolver esa diferencia local.

Build final: `.local/pipeline-os/dv-publication/build.json` y build.log. Su
sourceTreeSha256 coincide con el inventario final. Entrada observada:
`.next/standalone/.local/pipeline-os/dv-publication/build-0VisAz/server.js`.
Es una estructura local de Windows; no se entrega como imagen Linux ni se exige
esa ruta al Dockerfile existente en Coolify.

Comprobación nueva: invocación de GET/POST del módulo de ruta compilado, con UUID,
Origin y petición ficticios, flagfalse y guard de red. **2/2** devolvieron404,
Cache-Control:no-store y SETUP_UNAVAILABLE. No se abrió puerto ni se hizo HTTP;
no se autenticó una cuenta ni se creó política/presupuesto. Evidencia:
`.local/pipeline-os/dv-publication/compiled-smoke.json`.

Prettier del empaquetador y `git diff --check` correctos. Los checks de TypeScript
formaron parte del build. La comprobación final de hashes asegura que no se
modificó el código probado al preparar estos documentos.

## Límites y gates pendientes

- Preparación local completada; sin SHA de commit nuevo, push o publicación.
- Docker no está disponible aquí: no se instalaron herramientas ni se construyeron
  imágenes Linux. Ambos builds/health del nuevo SHA siguen pendientes en Coolify.
- Estado actual de main remoto, flags, workerpaused e imagen recuperable requieren
  lectura posterior antes del push autorizado. No se presentan los datos históricos
  como si se hubieran reconsultado hoy.
- Cupo proxy pendiente para el check real; no bloquea publicar código apagado.
  Habilitar la administración limitada, política y presupuesto requiere su etapa
  autorizada. Este paquete no activa ni consume Composio.
- La pausa completa sigue siendo confirmación operativa; las lecturas de candidato
  y presupuesto no se convierten en una única transacción. Se conservan las guardas
  de052 y del verificador; no se declara protección nueva que el SQL no ofrezca.

Siguiente: revisión y commit local del candidato seleccionado; después, autorización
expresa de push a main/despliegues automáticos y smoke acotado. Revalidar estado y
detenerse ante drift; no repetir SQL, cambiar flags ni ampliar el ensayo.
