# Paquete de campañas por archivo

Estado: promoción autorizada, SQL aplicado y verificado; publicación de app pendiente. Candidato base a34a08938cc637aa28b5176af31368cce30c554c, integrado sobre90a95ce139f3454e6dd33fb4d8b4b2a7c26d08ed en el worktree campaign-import-publish-20261116, sin modificar WIP del coordinador.

Payload final: campaign-import.patch, 14 archivos; aplicación comprobada contra la base mediante un índice Git temporal, sin cambiar el índice real. SHA256 del patch: 04dd84461f9125ecd6ef6d71a11c138eec16933993773acc9d257b29a2dfb30f. manifest.json contiene los blobs Git antes/después y SHA256 del archivo candidato. Los blobs Git permiten comprobar compatibilidad sin confundir CRLF/LF del working tree. El manifiesto anterior aprobado queda en evidence/approved-manifest.json; el delta final solo cierra los permisos service_role heredados sobre las cinco funciones y prueba ese cierre.

| Grupo | Archivos | Efecto |
|---|---|---|
| Componentes existentes,3 | import-wizard.tsx, campaign-composer.tsx, pipeline-os/workspace.tsx | callback del lote, reintento estable, audiencia por archivo, entrada inline |
| Nuevos componentes,2 | pipeline-os/campaign-import-flow.tsx y .css | recorrido y clasificación con aprobación explícita |
| Contrato y servidor,3 | lib/campaign-import.ts, lib/server/campaign-import.ts, app/api/campaigns/import/route.ts | sesión/origen, validación, RPC por lote, cierre503 sin fallback |
| Tests,2 | tests/campaign-import-flow.test.ts, tests/fixtures/campaign-import-browser.tsx | SQL/HTTP y fixture visual local sin ruta productiva |
| SQL,4 | migrations/up.sql, down.sql, preflight.sql, revoke-inherited-service.sql de este paquete | cinco funciones aditivas; reversa sin borrar datos; lectura previa y cierre de permisos heredados |

La documentación SDD y las evidencias de esta carpeta acompañan al payload. No incluye .local, node_modules, env reales, WIP ajeno, cambios de worker, dependencias o AGENTS raíz. No se reservó un ordinal de migración productiva.

Validación inicial:26/26 pruebas. Validación final integrada:48/48, TypeScript exit0 y Next build --webpack exit0. Catálogo productivo conciliado:17 fuentes y99 columnas compatibles; respaldo privado nuevo con listado/decodificación comprobados. Postflight:5 funciones nuevas y391 anteriores intactas, tablas/triggers sin cambios. Detalles en verification.md, release-progress.md y evidence/production-sql-postflight.json.

Alcance aprobado por el usuario (respuesta A): conciliar catálogo y respaldo del Supabase autoalojado, integrar solo este paquete, aplicar el SQL y publicar en crm.finlabinc.com con smoke de solo lectura. Sin consumir Bouncer, cargar clientes reales, activar/programar campañas ni enviar correos para probar el release. El usuario conserva la decisión de activación manual de cada campaña.
