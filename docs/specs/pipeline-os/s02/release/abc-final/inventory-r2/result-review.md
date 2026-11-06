# AF-INV-r2 — lectura autorizada y explicación del orden

01/11/2026 · El operador autorizó una ejecución manual READ ONLY y aportó su resultado. Autorización de esta lectura consumida: una ejecución del operador, cero consultas del agente, cero reintentos. No se comparte conexión autenticada del agente ni se inventa hora/estado de la sesión SQL.

Resultado recibido: protocolo AF-INV-r2, supabase_admin, PostgreSQL150008, READ ONLY on, collation en_US.UTF-8, expectedCount=actualCount=206, missingCount=extraCount=0, ambas listas de diferencias vacías, exactSetMatch=true y orderedArrayMatch=true. Es transcripción semántica del chat, no archivo original byte a byte.

## Por qué orderedArrayMatch=true no reproduce la guarda fallida

La consulta diagnóstica calcula format(... n.nspname,p.proname,...) y ordena ese texto directamente. Las entradas de nombre del catálogo aportan collation C. En049, las mismas firmas primero se convierten a keys JSONB y luego salen por jsonb_object_keys(observed->'functions'); ese texto tiene collation default. En la base informada, default es en_US.UTF-8. Por eso las dos expresiones de ORDER BY no comparan bajo la misma collation, aunque ambas parecen ordenar firmas.

La prueba local de pg_collation_for reproduce direct_collation="C" y json_key_collation="default". La simulación anterior con las mismas206 firmas y orden de idioma ya mostró41 posiciones diferentes; no es ejecución nativa en PG15 ni una lectura de collation de las expresiones remotas. La collation de la DB y la ausencia de diferencias de firmas sí provienen de la salida actual del operador. Esta trazabilidad explica el resultado sin pedir otra consulta ni asumir funciones adicionales.

La corrección por conjunto JSONB elimina esa dependencia de orden y mantiene el rechazo de diferencias reales. No se cambia otra vez049, su contrato o los cuerpos A/B/C por recibir este resultado. Se descarta para esta instantánea un inventario actual con faltantes/adicionales o diferencias de firma frente al esperado. No se afirma que otros gates de049, los binarios, el control del worker o el despliegue estén aceptados.

La auditoría del archivo local encontró049 con el hash exacto del original fallido `c453ca4c9e4cdfe049fec21b0ed7008e1107efa473e9538c0fb22d70fa3367c7`, distinto al r2 revisado. No se atribuye quién/cuándo lo sustituyó. Se repusieron solo las expresiones de inventario después de comprobar que el original coincidía byte a byte con la copia conocida y que la reconstrucción da exactamente el hash r2 `ba65aa6d0a9d63b0c949d72ad4fbae091339f8d3ae1a56aabb1d6eff55c82187`. No se descartaron otros deltas ni se cambió contrato/cuerpos/permisos. Esto reconcilia el artefacto local; no es una ejecución de SQL remoto.

Se añadió una prueba local específica del cambio de collation al pasar por JSON. Se ejecuta solo ese caso nuevo; las cuatro pruebas de la revisión anterior y las15 del paquete original conservan su evidencia y no se repiten. Instantly43/0 nuevas, Gmail directo conservado y Composio deshabilitado; sin SQL remoto del agente, DDL, envíos, despliegue o cambios a contadores.

**Resultado:** diagnóstico de inventario aceptado para la instantánea recibida. No ejecutar otra migración para corregir el catálogo, ni repetir048 o el diagnóstico. La preparación049 con guarda corregida sigue pendiente de sus gates y autorización de aplicación/publicación; esta autorización de lectura no los cubre.
