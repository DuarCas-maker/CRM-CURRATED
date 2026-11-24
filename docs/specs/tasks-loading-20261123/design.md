# Diseño

T-001 / FR-004: observar el fetch del mismo cliente autenticado en loadTasksOverview. Agrupar solo por último segmento de recurso válido; contar y medir, repropagar el error original, no registrar contenido. Prueba sintética verifica privacidad y preservación de resultado/error. Sin caché ni credenciales diferentes.

T-002 / FR-001/002: confirmar fase lenta; cambio mínimo sobre esa causa con regresión roja/verde y equivalencia de filtros.
T-003 / FR-003: ocultar la región de etapas cuando el resumen falla; no dejar un estado de carga falso.
T-004: suite relacionada, tipos, build público aislado y QA de carga/error/reintento.
T-005: publicación y comprobación real repetida con agregados únicamente.
