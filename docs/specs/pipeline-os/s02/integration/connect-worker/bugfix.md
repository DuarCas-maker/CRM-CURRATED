# CW-FIX01 — generaciones de configuración

Síntoma confirmado en reproducción local: una publicación inferior puede sobrescribir una superior intercalada después del SELECT inicial de composio_connect_publish. Causa: ON CONFLICT UPDATE sin predicado sobre la versión de la fila bloqueada.

La primera fixture con BEFORE INSERT trigger fue descartada: producía el error de cardinalidad de PostgreSQL para dos cambios de la misma fila dentro del INSERT, no el fallo buscado. La reproducción válida instrumenta temporalmente la función en memoria e invoca publish(3) tras el precheck de publish(2), antes del INSERT exterior. Con la entrega original no se rechaza publish(2); la prueba falla con Missing expected rejection. Las fases posteriores también encuentran la configuración obsoleta. No se usan conexiones físicas simultáneas ni se atribuye esa cobertura.

Corrección mínima: predicado `configuration.generation < excluded.generation` en el UPDATE atómico y CONNECT_STALE cuando no se cambia ninguna fila. Se mantienen la validación previa, permisos de servicio, search_path, inputs, límites y todas las guardas. La prueba corregida rechaza la publicación regresiva; el error revierte también el publish anidado de fixture. Otra prueba confirma que una generación superior ya confirmada no retrocede ni se vuelve a publicar.

Archivo de origen F2 preservado en su checkout. La SQL integrada tiene un hash distinto declarado en manifest.json; no se certifica su cambio con las pruebas nativas de la entrega original.
