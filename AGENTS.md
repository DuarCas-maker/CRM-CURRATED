<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- pipeline-os-parallel:start -->

# Pipeline OS: trabajo paralelo S00 / S01

Leer `docs/specs/pipeline-os/parallel-development.md` antes de editar. El usuario autorizó un segundo chat S01 en worktree aislado, conservando la base actual; no producción, push, merge, migraciones remotas o llamadas externas por abrir ese chat.

- Coordinador/S00: conserva proveedores, credenciales/contadores privados, documentación raíz de Pipeline OS y archivos compartidos. Instantly está en43 consumidas/v7 BR28 completed/stage13 tras15 nuevas/N15/R0/H0 autorizadas20/48 el29/10/2026: dos leads, aislamiento A/B y cierre pausado válidos, sin reconfigurar campaña/envíos/operaciones pagas. Snapshot28 y proyección CFD histórica false, BR failed27/antecedentes19 intactos;9 archivos privados anteriores restantes iguales. No reabrir terminal/restaurar fuentes/gastar remanente5; B recuperada operativamente, C/D/S00 pendientes. Los permisos no se heredan en S01.
- S01: empezar en T01-01 (discovery, preguntas nuevas y contratos SDD). Escribir solo en `docs/specs/pipeline-os/s01/**` durante esta preparación. Los módulos nuevos `src/lib/pipeline-os/s01/**` y tests `tests/pipeline-os-s01*.test.ts` quedan reservados para incrementos locales posteriores aprobados; no implementar producto por recibir el encargo de preparar el sprint.
- S01 lee la base y los documentos comunes, pero no edita componentes/rutas/worker/modelos compartidos, `supabase/migrations/**`, manifests/lockfile, este AGENTS.md ni documentos raíz. Proponer sus cambios en documentos S01 y transferir propiedad explícitamente antes de editar compartidos.
- No abrir/copiar `.env` reales, `.local/**` de otro checkout, adjuntos privados o contadores. No iniciar worker/servidores/servicios, usar APIs o tocar Supabase remoto desde S01. SQL preliminar solo en `docs/specs/pipeline-os/s01/migrations/`, para posterior prueba aislada y numeración coordinada.
- Respetar SDD y reutilizar las decisiones D01–D24; preguntar únicamente ambigüedades nuevas del sprint. Registrar hallazgos, propuestas, checks y pendientes en S01; no declarar S01/S00 completados por preparar contratos.
- Cada chat trabaja en su propio directorio/rama. Integración posterior revisada, con pruebas y autorización de push/merge/despliegue cuando corresponda. No reset/stash/clean/revert sobre cambios ajenos o snapshots para ocultar conflictos.

<!-- pipeline-os-parallel:end -->
