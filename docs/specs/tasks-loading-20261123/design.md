# Diseño

T-001 / FR-004: observar el fetch del mismo cliente autenticado en loadTasksOverview. Agrupar solo por último segmento de recurso válido; contar y medir, repropagar el error original, no registrar contenido. Prueba sintética verifica privacidad y preservación de resultado/error. Sin caché ni credenciales diferentes.

T-002 / FR-001/002: confirmar fase lenta; cambio mínimo sobre esa causa con regresión roja/verde y equivalencia de filtros.
T-003 / FR-003: ocultar la región de etapas cuando el resumen falla; no dejar un estado de carga falso.
T-004: suite relacionada, tipos, build público aislado y QA de carga/error/reintento.
T-005: publicación y comprobación real repetida con agregados únicamente.

## Causa confirmada y diseño acotado

T-002 cambia exclusivamente la lectura de metadatos de lead_workspace: misma vista security_invoker, mismo cliente/MFA/RLS y ocho campos, orden estable por id; páginas con cursor id>último, hasta página vacía. No solicita COUNT, ni interpreta página corta como final (REST puede limitar a17/500/1000). Total calculado por el agregador existente sobre todas las filas leídas, no una estimación. Guarda100000 y validación estricta de progreso/IDs impiden loops, duplicados o éxito parcial. Error de cualquier página aborta el resumen. No se cambia el lector genérico con count exacto ni se amplía acceso, caché o timeout del navegador.

AC-001/002: 4.040 leads, cap pequeño y fixtures con cuentas compartidas conservan totales. Negativas: segunda página falla, orden/duplicado/identidad inválidos y límite. Roles closer siguen sin solicitar leads. FR-003: ocultar renderStages si error; QA ficticia confirmó carga terminada/reintento exitoso sin GET adicional de tablero.
