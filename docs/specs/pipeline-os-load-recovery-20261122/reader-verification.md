# Lector sin COUNT — evidencia del candidato

059 aplicado con autorización explícita, backup verificado y atributos intactos (database/production-result.json). Postflight todavía falla en Board~9703ms; Workspace responde~12419ms incluyendo navegador. Registro nuevo confirma pipeline_os.mail_conversations_visible/57014. La vista responde~2–4s individualmente en Workspace; el tablero repite el Function Scan y su COUNT por lotes.

REC-CR002: regresión roja en7972157 para Board/Master/Tareas con57014 al pedir COUNT de mail, tres fallos. Tras la secuencia de metadata sin COUNT hasta página vacía:3/3 correctas. Suite focal26/26, incluyendo cap1/17/1000, duplicados/orden/fallo de segunda página/límite, mensajes ajenos excluidos y snapshot único de Tareas. Los otros catálogos siguen exigiendo count exacto, sin estimaciones de producto.

Suite amplia actual128/128 correctas, cero omisiones, offline.mjs/css-test-loader/concurrencia2. TypeScript --noEmit --incremental false correcto. Build aislado público Node22.23.4/Next16.3.8 --webpack correcto,60/60 páginas. Diff/whitespace correcto, sin env reales o cambios SQL adicionales.

Revisión propia: mismo cliente autenticado, vista y columnas; valida todas las filas y guarda solo expedientes elegibles; no caché entre usuarios. Una plaza del presupuesto6 cubre la secuencia y libera al fallar/terminar. Los mensajes siguen en lotes≤50/cap4 y filtros de área existentes. Errores/límite100000 no generan resultados parciales. La prueba I02 histórica descrita en database/verification.md permanece intacta y falla sin candidato;12 pruebas SQL de equivalencia/permisos/reversa correctas.

Pendiente publicar lector, healthy y tres entradas reales/API sin57014. FR-003/006/007 no cerrados por pruebas locales. Autorización de publicar la misma web vigente en el chat.
