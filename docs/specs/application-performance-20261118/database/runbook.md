# Aplicación autorizada y verificada

El usuario aprobó respaldo, índice y verificación en producción después de revisar el candidato. Ejecución terminada: respaldo verificado, CREATE INDEX CONCURRENTLY aceptado por la API, índice válido/ready y tres lecturas de Reportes sin error. Los pasos siguientes conservan el procedimiento y las condiciones para una futura ejecución; no repetir sobre el índice existente.

Destino: PostgreSQL15 de Supabase self-hosted en https://supabase.finlabinc.com; aplicación https://crm.finlabinc.com. Script `production-index.mjs`, índice `index.sql`, reversa `down.sql`. Sin cambios de datos, RPC, RLS, grants o infraestructura. No requiere redeploy de la web ni worker.

1. `node production-index.mjs plan`: offline, sin credenciales/red. Revisar el SQL exacto.
2. Solo con nueva aprobación explícita: reutilizar las credenciales existentes mediante `node --env-file=<archivo local autorizado>` sin imprimirlas. Ejecutar `inspect` (lectura): valida destino postgres/PG15, cuerpos invoker esperados y ausencia del índice. Devuelve solo metadatos.
3. Ejecutar `backup --authorized-production-index`: `pg_dump` completo en directorio privado nuevo dentro del volumen PostgreSQL, permisos700/600; `pg_restore --list` y decodificación completa a /dev/null verifican archivo. Guarda solo ruta/tamaño/hash localmente; el respaldo no sale del servidor. No es un ensayo completo de recuperación de desastre. Si falla, detener; si la respuesta se pierde, usar `backup-inspect`, sin repetir el respaldo a ciegas.
4. `apply --authorized-production-index`: exige respaldo verificado de menos de una hora, hash del SQL y catálogo intactos. Envía únicamente CREATE INDEX CONCURRENTLY en un request, fuera de BEGIN/COMMIT; comprueba definición exacta, indisvalid/indisready y guardas de funciones/políticas/grants. Si la API no admite DDL concurrente, detener: no sustituir por CREATE INDEX bloqueante.
5. Si falla o se pierde la respuesta, `inspect` antes de decidir. No reintentar automáticamente: el índice puede existir inválido o seguir construyéndose. No eliminar un índice ajeno por compartir nombre.
6. Postflight: tres lecturas reales autenticadas de Reportes, sin timeout/error; registrar duración y resultado, sin registros de clientes. Comparar con8513ms + timeout anterior. Un índice válido no demuestra por sí solo que el problema esté resuelto.

Reversa: comprobar tabla/columna/predicado del índice propio y que no hay construcción activa; ejecutar solo `down.sql` como sentencia standalone. No restaurar el dump completo para retirar este índice. Repetir postflight y comparar guardas. Si el resultado continúa lento, conservar evidencia y diagnosticar el siguiente cuello de botella antes de proponer cambios nuevos.

Límite local: PGlite prueba índice equivalente sin CONCURRENTLY, resultados/permisos y reversa con datos ficticios. No se dispone de PostgreSQL15 nativo local, por lo que concurrencia/bloqueos y API SQL se verificarán únicamente tras aprobación remota. CREATE INDEX CONCURRENTLY hace dos barridos y puede esperar transacciones; no garantiza cero espera. Véase https://www.postgresql.org/docs/15/sql-createindex.html.
