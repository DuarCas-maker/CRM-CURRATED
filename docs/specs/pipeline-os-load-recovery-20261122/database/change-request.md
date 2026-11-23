# REC-CR001 — optimizar proyección interna de correo — STRICT

Diagnóstico autorizado ejecutado22/11/2026: PostgreSQL15.8, vista security_invoker sobre s01_i02.visible_conversations() SECURITY DEFINER sin argumentos. EXPLAIN sin ANALYZE confirma Function Scan con el filtro por expediente fuera de la función. Volúmenes aproximados:799 conversaciones,2039 mensajes,835 oportunidades. El índice único de mensajes ya comienza por conversation_id; agregar otro índice no elimina las evaluaciones repetidas de permisos.

La publicación7972157 retiró el sondeo global del lector, pero no recuperó producción: Board y Workspace siguen agotando statement_timeout. Se amplía STANDARD a STRICT porque la corrección requiere reemplazar una función interna de autorización/redacción. No se cambia el objetivo ni hay una decisión de negocio nueva: recuperar la entrada y preservar todos los permisos y datos. La autorización nueva del usuario cubre solamente el diagnóstico remoto; migración y respaldo requieren aprobación concreta posterior.

FR-004: calcular los permisos estables por expediente una vez por lectura y reutilizarlos para elegir el último mensaje visible. AC-004: igualdad exacta de las15 columnas con la función previa para admin, seller/closer propios/ajenos, MFA ausente, inactivos, casos no calificados/archivados, conversaciones vacías/mixtas, empates y mensajes sin archivo.

FR-005: conservar firma, propietario, ACL, SECURITY DEFINER, search_path, vista y políticas actuales. AC-005: snapshot de catálogo antes/después solo permite cambiar prosrc; reversa restaura el original. Fallar cerrado si la fuente previa difiere del hash diagnosticado.

FR-006: aplicar solo con autorización específica y respaldo privado de la definición; verificar recuperación real. AC-006: transacción con límites, postflight hash y tres entradas SSR/API correctas, sin aumentar timeout ni escribir filas de negocio. No declarar recuperación por un benchmark local.

G0/G1: diagnóstico y alcance anteriores confirmados; esta preparación local está comprendida en revisar/aplicar del chat. G2/G3: diseño y tareas locales definidos; G6 pendiente de aprobación de la mutación remota. Riesgo principal: equivalencia de permisos/redacción; mitigación con comparación SQL real, roles negativos y reversa probada. No hay cambios de tipos, constraints, filas, OAuth, proveedores, worker ni dependencias.
