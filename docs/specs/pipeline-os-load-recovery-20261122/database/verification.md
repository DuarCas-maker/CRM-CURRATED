# Verificación local y diagnóstico remoto —22/11/2026

FR-004 diagnóstico: ejecutado únicamente diagnose-mail-database.mjs autorizado, seis transacciones READ ONLY/5s. PostgreSQL15.8;799 conversaciones/2039 mensajes/835 oportunidades aproximadas. EXPLAIN sin ANALYZE muestra Function Scan y filtro externo. No se consultaron registros de clientes ni se modificó la base.

AC-004/005:12/12 checks nuevos correctos con PGlite sin red. Compara todas las15 columnas de la función antes/después para admin, seller, closer, ajeno, AAL1, seller_admin, closer_admin e inactivos/anon. Datos ficticios: casos archivados/no calificados, con/sin closer, hilos vacíos/mixtos, empates, archivo y outbox, submission/process no nulos. Se preservan redacción y último mensaje visible. Catálogo pg_proc completo idéntico salvo prosrc, así como vistas/políticas; apply/rollback/reapply correctos. Fuente inesperada y postflight adulterado abortan sin cambiar el estado.

Regresión roja explícita: PROJECTION_COMPARE_BASELINE=1 en el test permission evaluations falla con4760/4760. Verde:4760→783 evaluaciones de can_area en200 expedientes/800 conversaciones/1200 mensajes. La guarda mide llamadas reales de SQL en el fixture, no compara únicamente strings de implementación.

Benchmark final representativo sin red:800 expedientes,800 conversaciones,2400 mensajes ficticios;739 filas visibles idénticas. Original493/525/501ms (mediana501), candidato237/237/246ms (mediana237), ~53% menos. El escenario previo200 expedientes/800 conversaciones obtuvo mediana~84ms frente~481ms; no se extrapola ese caso favorable a producción. PGlite no es el PostgreSQL15 de producción; estos resultados no acreditan recuperación ni una latencia productiva.

Suite ampliada:54 checks enumerados,52 pass y2 fail correspondientes a una sola aserción y su padre en pipeline-os-s01-mail-permissions.test.ts:235 (2!==1). Reproducción aislada sin cargar candidato:13 checks,11 pass/2 fail, mismo fallo. Ese test histórico espera que seller_admin vea un único mensaje; las reglas055 actuales permiten dos en su caso. No se cambió ni relajó el test ni los permisos. Los29 checks de los otros módulos y los12 nuevos pasaron, además de11 de la suite histórica. La recuperación utiliza los permisos actuales y exige equivalencia, no restaurar la regla histórica.

TypeScript --noEmit --incremental false correcto; node --check de scripts correcto; git diff --check correcto. Revisión propia del candidato y transacción: firma15 columnas, búsqueda segura, propietario/ACL y todos los atributos preservados, sin nuevas capacidades, sin SQL dinámico procedente de usuario ni escrituras de negocio. No cambios de frontend o dependencias, por lo que no se repitió build Next; el mismo código de aplicación7972157 ya pasó build60/60.

Fuentes actuales/candidato:084a8b1c0f058da519cfbfa5e1e1f762→5aec37664aba3b60375426679e39929b. Migración y rollback generados desde las funciones versionadas. Modo --plan de production-function.mjs ejecutado offline, sin cargar credenciales. Publicación/backup/mutación remotos de059 pendientes de nueva aprobación; no acreditados por la autorización del diagnóstico.

Se preservan bytes SQL mediante .gitattributes local de esta carpeta (*.sql -text): el original diagnosticado mezcla CRLF/LF y su reversa exige el mismo hash. No permitir conversión automática de saltos de línea al versionar. El catálogo y el benchmark completos privados permanecen en .local; esta carpeta contiene solo fuentes SQL y evidencia sanitizada.

Comandos relevantes:

```
node --import ./tests/offline.mjs --import tsx --test --test-reporter=spec --test-concurrency=1 tests/pipeline-mail-projection.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node docs/specs/pipeline-os-load-recovery-20261122/database/production-function.mjs --plan
```
