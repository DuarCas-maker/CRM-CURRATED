# Verificación — resumen de tareas abiertas

STANDARD · codex/s00-auto-receive · 2026-11-18.

**Actualización de publicación:** autorización explícita recibida para producción. El candidato se concilió con main 7dde2e8 y el resumen actual de Campaign Control: enviados únicos por contacto, con grupos visibles y desglose por cuenta. Las 64 pruebas y capturas que siguen documentan el primer candidato local (antes de esta conciliación). El candidato integrado pasa 92 pruebas con Node22.23.4 y build correcto; ver publication/preflight.md y publication/runbook.md. El resultado productivo se registra después de observarlo, sin anticiparlo aquí.

## Línea base

`node --import ./tests/offline.mjs --import tsx --test --test-concurrency=2 tests/pipeline-os-module.test.ts tests/pipeline-os-module-ui.test.ts tests/pipeline-master.test.ts tests/pipeline-master-reader.test.ts`: 36/36 correctos, cero fallos.

WIP previo en next.config.ts, layout.tsx, crm.tsx, workspace.tsx, supabase.ts, workspace-mail.ts, workspace.ts y tests/workspace-mail.test.ts, además de archivos no versionados; se conserva. Único solapamiento previsto: adición localizada a workspace.tsx.

## Matriz final

| FR / AC                 | Tareas    | Verificación                                                                  | Estado                                                                                                                 |
| ----------------------- | --------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| FR-001/002 / AC-001/002 | T-001/002 | Agregador y desglose por cuenta con contactos repetidos y campañas múltiples. | ✅ 3 primeros envíos / 2 contactos que respondieron; un contacto en dos cuentas no duplica los leads.                  |
| FR-003 / AC-003         | T-001/002 | Etapas coherentes con buildPipelineBoard y navegación.                        | ✅ Total de 73 expedientes en sus etapas; clic lenders de Santino abre sus 7 expedientes.                              |
| FR-004 / AC-004         | T-001/002 | Selección, filtros de gestión, búsqueda y más de 50 leads.                    | ✅ Santino 37, Samuel 36, gestionados de Santino 2, segunda cuenta 1, segunda página 23 / 73, búsqueda 1.              |
| FR-005 / AC-005         | T-001     | Lecturas mínimas, rol seller/closer, HTTP y catálogo incompleto.              | ✅ Roles, filtro falsificado, errores 401/403/503, metadatos mínimos y leads sin enlaces a expedientes no disponibles. |
| FR-006 / AC-006         | T-002/003 | Carga/vacío/error/cancelación, teclado y 360/768/1280.                        | ✅ Navegador local con fetch ficticio, cambio rápido, teclado, error/reintento, vacío y cero errores de consola.       |

## Comprobaciones

- Node v24.22.1 disponible en este host (package.json solicita Node 22; no se instaló otro runtime).
- `pnpm exec tsc --noEmit --incremental false`: correcto.
- `pnpm exec prettier --check` sobre fuentes, pruebas, scripts y cuatro documentos del incremento: correcto.
- `git diff --check`: correcto.
- Suite final con `node --import ./tests/offline.mjs --import tsx --test --test-concurrency=2`: **64 pruebas correctas, 0 fallos, 0 omitidas**. Archivos:
  - `tests/tasks-overview.test.ts`, `tests/tasks-overview-reader.test.ts`, `tests/tasks-overview-http.test.ts`, `tests/tasks-overview-ui.test.tsx` (9 nuevas).
  - `tests/campaign-center.test.ts`: contrato de primeros envíos, respuestas, paginación y RLS en base embebida.
  - `tests/pipeline-os-module.test.ts`, `tests/pipeline-os-module-ui.test.ts`, `tests/pipeline-os-module-pagination.test.ts`, `tests/pipeline-os-module-http.test.ts`, `tests/pipeline-os-module-db.test.ts`: incluye esquema real con dos usuarios/RLS.
  - `tests/pipeline-master.test.ts`, `tests/pipeline-master-reader.test.ts`, `tests/workspace-performance.test.ts`, `tests/workspace-reader.test.ts`.
- `node scripts/verify-tasks-overview-build.mjs`: correcto, salida 0, 51 páginas estáticas y ruta `/api/pipeline-os/tasks`. Copia pública aislada sin archivos env ni credenciales heredadas; Next build --webpack. La última ejecución incluye la guarda final de expedientes no disponibles.

## QA visual

`node scripts/preview-tasks-overview.mjs` compila y sirve una fixture propia en loopback. Fetch sustituido por datos ficticios; CSP connect-src none. No usa servidor Next, Supabase, worker, cuentas ni APIs reales.

| Ancho CSS observado | Ancho del documento | Tabla visible / contenido            | Evidencia                               |
| ------------------- | ------------------- | ------------------------------------ | --------------------------------------- |
| 360                 | 346                 | 317 / 1130, scroll contenido         | [Móvil](evidence/mobile-360.jpg)        |
| 768                 | 755                 | 713 / 1150, scroll contenido         | [Tablet](evidence/tablet-768.jpg)       |
| 1280                | 1266                | 1213 / 1213, nueve columnas visibles | [Escritorio](evidence/desktop-1280.jpg) |

El navegador estaba ampliado al 110 %; el viewport se ajustó a partir del ancho CSS observado, sin cambiar esa preferencia. El override se retiró al terminar. Selección por Enter y foco por Tab comprobados; las regiones de tablas son enfocables y tienen desplazamiento independiente. [Resultados observados](evidence/ui-checks.json).

## Revisión del delta

Skill safe-code-review, en modo revisión. Se revisaron agregador, lector, contrato, componente, estilos y la integración localizada en workspace. Sin hallazgos pendientes del delta revisado. Se corrigieron durante la implementación: receptor distinto del lead no acredita gestión, no enlazar expedientes no disponibles, cancelación/timeout con WorkspaceReader y evitar el resumen redundante de campañas al leer etapas.

El WIP previo de rendimiento y administración permanece; las únicas ediciones propias a archivos existentes son la integración de OpenTasksOverview en workspace.tsx y dos opciones internas aditivas en readPipelineBoard. No se cambiaron manifests, lockfile, migraciones, worker ni configuración de despliegue.

## Límites y reversa

- No se leyó producción ni se verificaron cifras reales o tiempos con su volumen; toda evidencia visual usa datos ficticios. Las respuestas cuentan mensajes humanos registrados en conversaciones CRM y hechos acreditados de Campañas, sin ejecutar una nueva lectura de Gmail.
- No se ejecutó la suite completa del repositorio; se ejecutó la regresión de las áreas afectadas.
- No hay script lint en package.json. Se verificaron formato, tipos, contratos, integración y build.
- Sin migraciones ni datos persistidos nuevos. Rollback: retirar importación y bloque OpenTasksOverview, sus archivos propios y las dos opciones internas aditivas del lector; conservar el WIP previo.
- Publicación fuera de alcance y pendiente de autorización explícita. Gates G0–G5 cubiertos; G6 no aplica a esta implementación local.
