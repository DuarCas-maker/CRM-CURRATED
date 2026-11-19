# Evidencia local del candidato

19/11/2026 UTC. No se ha ejecutado DDL, backup ni escritura remota para este candidato. La autorización actual cubre diagnóstico de lectura.

DB-T-002 / AC-DB-001,002,003: Node22.23.4, guardia offline y PGlite existente; `tests/workspace-report-index.test.ts` pasa1/1. Crea2 oportunidades ficticias de propietarios distintos,5000 filas de importación incluyendo duplicados; compara JSON completo de workspace_stats antes/después para admin, seller, ajeno y MFA insuficiente, comprueba denegación anon y cuerpo/ACL del RPC intactos. El acceso selectivo usa el índice nuevo y la reversa lo retira. Transacción fija el reloj para evitar diferencias por now().

La prueba transforma únicamente CREATE/DROP INDEX CONCURRENTLY a CREATE/DROP INDEX porque PGlite es single-user. No prueba bloqueo/concurrencia ni el transporte SQL de producción. No atribuir estos resultados a PostgreSQL15 real.

DB-T-001: metadatos y EXPLAIN remoto sin ANALYZE, sin JWT ni filas de negocio, ejecutados bajo aprobación de lectura. Indican falta de índice por contacto/result en import_rows y Seq Scan costoso. Las estimaciones no prueban rendimiento real del usuario.

Pendiente DB-T-003: aprobación de backup + índice, archivo de respaldo verificado, catálogo antes/después, índice valid/ready y tres lecturas autenticadas reales de Reportes.

## Postflight real — DB-T-003 completado

Autorización explícita adicional del usuario: «A) Autorizar respaldo, índice y verificación en producción (recomendado)». Credenciales existentes usadas en memoria mediante Node22 --env-file, sin imprimirlas ni persistirlas. Destino comprobado: postgres/PG15.8 en supabase.finlabinc.com.

- Respaldo69.927.076 bytes en volumen PostgreSQL; archivo privado, listado y decodificación completa con pg_restore correctos. No se descargó el dump. El primer verificador local rechazó el salto de línea final del SHA; se corrigió trim() y se comprobó por lectura el mismo respaldo, sin crearlo otra vez. No se acredita una recuperación completa en otro servidor.
- CREATE INDEX CONCURRENTLY standalone terminó correctamente. El catálogo posterior confirma definición exacta, indisvalid=true, indisready=true y ninguna construcción activa. Huellas de funciones públicas, políticas y grants/RLS de tablas iguales antes/después.
- Lecturas GET autenticadas de Reportes:5627/5913/5729ms, stats presente y error=null en3/3. Antes:8513ms y statement timeout. Mismo mecanismo de navegador, incluye navegación/render JSON/observación, no tiempo SQL aislado ni p95. Sin guardar registros de clientes.
- Pantalla Indicadores cargó “Resultados con contexto.”, con las tres secciones de resultados, sin carga pendiente, alertas o nuevos errores/warnings de consola. La primera espera de QA buscó un título incorrecto (“Indicadores”); se observó el título real, por lo que no se atribuye una medición de duración a ese paso.
- Reversa no ejecutada en producción porque el cambio pasó; probada localmente. Runbook y down.sql disponibles. No se modificaron filas, funciones ni políticas; no se aumentó el statement_timeout del RPC para ocultar el problema.

Fuente canónica para bootstrap: supabase/migrations/058_workspace_imported_contact_index.sql. La forma CONCURRENTLY publicada en index.sql es equivalente y quedó aplicada; comparación automatizada incluida en la prueba.
