# Diseño y decisión — índice parcial no único

Conservar íntegra la consulta desplegada y añadir un índice de contact_id solo para filas result='imported'. El predicado coincide con el literal de workspace_stats. No indexar JSON ni ampliar permisos; ninguna función se sustituye. ADR-DB-001: preferir este acceso físico reversible a reescribir el agregado antes de medir su efecto.

Crear CONCURRENTLY en una sentencia independiente para permitir DML durante construcción; no combinar con SET/BEGIN. Verificar nombre/definición/indisvalid/indisready: IF NOT EXISTS por sí solo no acredita equivalencia. Si se pierde la respuesta, inspeccionar el estado antes de intentar otra operación. Reversa DROP INDEX CONCURRENTLY del índice propio; nunca quitar otro índice por nombre sin cotejar su definición.

Preflight registra catálogo y huellas; aplicar solo con aprobación específica de la base de producción. Respaldar en el volumen PostgreSQL existente mediante pg_dump custom y verificar con pg_restore list/decode; no copiar filas al equipo. La aplicación permanece desplegada y no se reconstruye el worker por este índice.

Fuentes primarias: [PostgreSQL15, CREATE INDEX](https://www.postgresql.org/docs/15/sql-createindex.html), [índices parciales](https://www.postgresql.org/docs/15/indexes-partial.html). No hay runtime PG15 nativo disponible aquí: ensayo local con PGlite comprueba contenido, plan y permisos; no acredita concurrencia física PG15. La creación concurrente real y su validez se comprueban después de autorización.

## Forma canónica y forma operativa

`supabase/migrations/058_workspace_imported_contact_index.sql` reproduce el índice en un bootstrap local o migraciones transaccionales. `index.sql` crea exactamente el mismo índice con CONCURRENTLY para producción existente. La prueba compara ambas sentencias quitando comentarios y esa única palabra; no hay divergencia de columna/predicado/unicidad. Se conserva esta distinción porque CONCURRENTLY no puede ejecutarse dentro de una transacción ni en el PGlite single-user de la suite.
