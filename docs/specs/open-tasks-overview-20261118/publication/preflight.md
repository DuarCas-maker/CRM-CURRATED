# Preflight del candidato integrado

2026-11-18 · base final 7dde2e8 · rama codex/open-tasks-release-20261118.

- Autorización explícita: desplegar tabla/filtros en el CRM de producción existente. Sin SQL, cambios de infraestructura, variables, proveedores, mensajes ni datos de negocio.
- Repositorio y main confirmados por Git y conector GitHub. CRM público: health200, login200, nuevo endpoint404 antes de publicar. Sesión humana existente carga Pipeline OS; tabla nueva ausente. No se guardan filas ni credenciales.
- Integración de tres vías conserva cambios concurrentes en campañas, plantillas, etapas, rendimiento y receptor nativo de fetch. Solo dos archivos de producto existentes reciben el delta de tareas abiertas.
- Runtime portátil oficial Node22.23.4 descargado por HTTPS y SHA256 cotejado con SHASUMS256.txt del mismo distribuidor; sin instalación global ni cambios del gestor/lockfile. Node24 no se usa para el gate final.
- **92/92 pruebas correctas, cero fallos u omisiones** en Node22. Incluye 10 nuevas de tareas, Campaign Center y Control (contratos SQL/roles/agrupación), etapas/case-flow, lector/tablero/HTTP/BD, Master y rendimiento/cancelación de Workspace. El reporter propio resume resultados sin volcar sentencias SQL de fixtures y conserva la salida del runner.
- TypeScript: correcto con Node22 y `tsc --noEmit --incremental false`.
- Build aislado con Node22: correcto, salida0, Next16.3.8, 60 páginas estáticas y nueva ruta /api/pipeline-os/tasks. Copia exclusivamente pública, sin env ni credenciales heredadas; no hubo Docker local.
- Comparación de métricas con el contrato actual: Campaign Control deduplica contact_id entre campañas/grupos. La fixture con un mismo lead en dos remitentes da 1 enviado en ese responsable y 1 en cada cuenta; más otro lead da 2 enviados en total, sin inflar por campañas/seguimientos.
- Revisión adicional: pipeline-os-workspace-stats-compat conserva **12 fallos basales** por ABC_BASE_FUNCTION_INVENTORY_MISMATCH en el before hook. Se reprodujeron en un checkout intacto de la base, también con Node22; sus fuentes/SQL no forman parte del delta y no se modificaron. No se confunden con una regresión de este candidato.
- El wrapper histórico campaign-control-http esperaba TAP y fallaba al comparar el texto de salida de Node24; con Node22 pasa íntegro dentro de las 92 pruebas, sin editarlo.

Comando de regresión: Node22 con `--import ./tests/offline.mjs --import tsx --test --test-concurrency=2 --test-reporter=./docs/specs/open-tasks-overview-20261118/publication/summary-reporter.mjs` y los tests tasks-overview (4), campaign-center, campaign-control y su HTTP, pipeline-os-module (módulo/UI/paginación/HTTP/BD), pipeline-master y lector, workspace-performance, workspace-reader, pipeline-os-case-flow (módulo/HTTP/BD).

Build reproducible: ejecutar con Node22 `scripts/verify-tasks-overview-build.mjs`. Sin mutaciones remotas durante este preflight. El push y postflight se registran en el resultado posterior.
