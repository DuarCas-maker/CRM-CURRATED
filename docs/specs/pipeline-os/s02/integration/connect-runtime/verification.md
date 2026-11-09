# CW-I02 — evidencia de integración offline

08/11/2026 · STRICT · [Requisitos](spec.md), [diseño](design.md), [tareas](tasks.md), [aceptación](acceptance.md), [continuidad](runbook.md), [manifiesto](manifest.json).

## Recepción y compatibilidad

Siete fuentes T-003/T-004 copiadas byte a byte después de comprobar sus dos recibos finales y la ausencia de los destinos. Se volvieron a comprobar las fuentes del worktree F2 tras la copia. No se integró su rama ni sus archivos T-009 en curso. Sus tests originales no se modificaron.

Los49 casos de origen se ejecutaron en root y pasaron; seis pruebas nuevas componen el motor con el adaptador real de código y transporte HTTP simulado. Comprueban un único candidato y replay sin otro enlace, identidad primaria equivocada, resultado incierto sin reintento, contexto/sesión obsoletos, compatibilidad de contexto C2/R06 y la separación entre identidad de alta y grants efectivos.

La última comprobación confirma el cierre temprano de C2: aunque el perfil de alta coincida, sin grants efectivos no consulta otro perfil ni devuelve evidencia positiva. Se ajustó la fixture que esperaba esa lectura; no se modificó ni relajó C2. El descriptor, credencial, respuestas, IDs y reloj usados son ficticios y no acreditan el proyecto real.

## Checks y límites

Selección final: **152 correctos,0 fallos,0 omitidos**:49 casos de origen, seis de composición nuevos y97 regresiones relevantes. TypeScript directo `--noEmit --incremental false` correcto. Logs propios en `.local/pipeline-os/connect-runtime-20261108/`, inventario en manifest.json. La regresión seleccionada cubre C3 (guard arquitectónica original intacta), C2, contratos/runtime R06, recepción DB y la composición CW previa. No se repitieron pilotos operativos de correo, adjuntos, importación o verificaciones.

Los tests de producto bloquean red real mediante el preload offline y usan fetch inyectado en memoria. No env reales, servicios, instalaciones, proveedor/OAuth, SQL remoto, mensajes, verificaciones de leads, push/deploy o activación Composio. Gmail directo y flags permanecen; Instantly43/0 nuevas. Todos los archivos previos de producto, las49 huellas operativas,049, HEAD e índice se cotejan por hash.

No se ejecutó aquí PostgreSQL15 físico ni se importó un adapter de persistencia de producción. El store de composición es un doble, y su CAS no certifica transacciones/locks. La evidencia nativa T-002 de origen no se reutiliza como aprobación de CW-I02. T-009 sigue en implementación según el snapshot observado del chat F2; no se da por recibido hasta su cierre y cotejo.

G0–G3: decisiones de los contratos existentes reutilizadas y alcance preciso. G4/G5 de este incremento: únicamente sus fuentes y resultados observados; no cierra la aceptación integrada completa de alta. G6 no ejecutado. La próxima entrega es recibir T-009 terminado y probar su composición con CW/R06 antes de los callers HTTP/UI.
