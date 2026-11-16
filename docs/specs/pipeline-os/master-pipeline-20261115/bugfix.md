# MP-INT01 · Identidad de paneles al conciliar el checklist

Reproducción: abrir la demo del candidato conciliado con01b6d3f, entrar en Master y abrir Evergreen Logistics. El navegador emitió `Encountered two children with the same key` para el ID ficticio `o1`.

Hipótesis: (1) IDs repetidos en filas/tareas de Master; (2) dos hijos del drawer con la misma key. Las filas de tareas se deduplican por ID y sus pruebas pasan. El código de01b6d3f añade `PipelineCaseProgress key={caseId}` como hermano de `PipelineMailReview key={caseId}`: confirma la segunda hipótesis sin cambiar datos ni ocultar errores.

Cambio mínimo en el archivo ya alcanzado por el candidato: el checklist usa `progress:${caseId}`. Sigue reiniciando su estado al cambiar de expediente y deja intacta la revisión de correo. No se modificó el checkout coordinador.

Regresión manual: abrir ambos paneles en el mismo drawer, verificar que el checklist y la revisión siguen presentes y que la consola de una pestaña nueva no emite el aviso. Se usa el navegador real porque los tests SSR estáticos disponibles no ejecutan la reconciliación de claves del cliente; no se agrega una dependencia de pruebas ni una aserción que solo copie la expresión corregida. Las pruebas existentes del checklist y Master, tipos y build se repiten para el resultado final.

Resultado observado: pestaña nueva, expediente abierto, checklist y revisión conservados; consola de errores/advertencias vacía (`evidence/integrated-console.json`). Suite final65/65 y build optimizado exit0.
