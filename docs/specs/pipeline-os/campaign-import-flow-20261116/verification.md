# Verificación local

SDD STRICT · CI-T01–T04 completadas · CI-T05 autorizado y en ejecución. Validación inicial:26/26. Validación final integrada:48/48 pruebas, cero fallos/omisiones; TypeScript y build terminan con código0. SQL productivo aplicado y comprobado; publicación de app pendiente. Estado de ejecución en release-progress.md.

Fuente: worktree aislado campaign-import-20261116, rama codex/campaign-import-flow-20261116, base a34a08938cc637aa28b5176af31368cce30c554c. Next16.3.8/React19.3/pnpm11.19/Node22.23.4. Se leyeron las guías instaladas de Route Handlers y CSS. Dependencias existentes por junction local; sin instalaciones, cambios de manifest/lock o lectura de env reales.

## Checks ejecutados

| Check local | Resultado | Evidencia |
|---|---|---|
| Node test runner + tests/offline.mjs + tsx, tests/campaign*.test.ts, concurrencia2 | 26/26, cero fallos/skips | evidence/local-checks.json |
| TypeScript tsc --noEmit --incremental false | exit0 | evidence/local-checks.json |
| prepare-pdf-viewer.mjs + Next build --webpack | exit0, incluida /api/campaigns/import | evidence/local-checks.json |
| SQL up/down sobre migraciones001–047 en PGlite | aplicación, alcance y reversa comprobados en tests | tests/campaign-import-flow.test.ts |
| Candidato con funciones/triggers reales de marca B2 instalados localmente | crea, conserva snapshot, replay y activación; rechaza contexto ausente/obsoleto y edición directa | prueba CI de installed brand guards |
| preflight.sql con contratos de marca instalados en PGlite | lectura parseada: 5 firmas, 9 relaciones, 2 triggers | evidence/preflight-local.json |
| Navegador local, componentes reales con backend ficticio | recorrido y estados comprobados | evidence/browser-observations.json |
| Navegación Next real /pipeline-os/demo | entrada Campañas y creador inline, sin modal anidado | evidence/pipeline-entry.jpg, browser-observations.json |

Comandos equivalentes reproducibles en PowerShell con Node22 y dependencias del proyecto (usar solo entorno ficticio, sin env productivos):

```powershell
$campaignTests = (Get-ChildItem -Path tests/campaign*.test.ts).FullName
node --import ./tests/offline.mjs --import tsx --test --test-concurrency=2 @campaignTests
node node_modules/typescript/bin/tsc --noEmit --incremental false
node scripts/prepare-pdf-viewer.mjs
node node_modules/next/dist/bin/next build --webpack
```

El driver ejecutado localmente fijó únicamente configuración ficticia: Supabase .invalid, clave pública ficticia, Connect deshabilitado y worker pausado solo en el proceso de checks. No inició worker ni modificó su configuración real. Los servidores de QA propios en64821/64822 se detuvieron al terminar; no quedaron listeners en esos puertos.

## Trazabilidad

| Requisito / aceptación | Evidencia observada |
|---|---|
| FR01 / AC01 | Campañas → Crear campaña abre el recorrido en segundo nivel; rol seller sin controles de creación. |
| FR02 / AC02 | XLSX generado con6 filas y un duplicado se previsualiza con el parser real. Fallo de respuesta de registro + reintento:2 peticiones,1 lote y1 clave. Fallo del refresh posterior conserva éxito y permite continuar. |
| FR03 / AC03 | Confirmación/cancelación explícita con cantidad y créditos; SQL rechaza cantidad obsoleta/nula, replay encola una vez, inciertos/técnicos no se repiten. Dos contactos del backend ficticio se aprobaron sin proveedor real. |
| FR04 / AC04 | Dos lotes y destinatarios ajenos; preview, snapshot y activación limitados al lote. Selección forjada y5001 IDs rechazados. Preparación de marca comprobada tanto en HTTP como con trigger SQL instalado. |
| FR05 / AC05 | Crear/verificar deja0 enrollments/outbox antes de activar. Borrador en navegador no pide activar ni muestra descarte tras guardar. Confirmar y activar llama solo entonces al comando existente. |
| FR06 / AC06 | CampaignCenter conservado. Regresiones existentes verifican aceptación Gmail, asociación de respuestas y métricas; no se infiere respuesta de intentos/tests/errores. |
| AC07 | anon, aal1, seller y remitente no permitido rechazados; helper interno no ejecutable; RPC ausente503 sin fallback global. Errores HTTP saneados. |
| AC08 | down.sql elimina las cinco funciones, conserva campaña e inscripción. Responsive DOM360/768/1280 sin overflow de página; entrada integrada móvil360, componente332. |

Captura de revisión: evidence/workflow-preview.jpg (componentes reales, datos ficticios). Los JSON browser-first-run/upload-run/saved-run registran las acciones de cada ensayo. Tabulación y Enter comprobados; estados vacío, carga, error, clasificación, confirmación y borrador revisados.

## Revisión del diff y límites

Modo revisión con safe-code-review: se trazaron alcance del lote, autenticación/origen, marcas, transacciones, replay, formulario y consumidores previos. Se corrigió un hallazgo confirmado: el wrapper B2 limpiaba brand_context y el UPDATE de audiencia recibía BRAND_PREPARATION_REQUIRED. La regresión reprodujo el fallo antes del arreglo; ahora reutiliza solo el snapshot recién generado dentro de la misma transacción y limpia después el contexto. La escritura directa sigue bloqueada. También se comprobaron conservación del éxito tras refresh fallido, clave estable de carga y salida tras guardar sin aviso de descarte.

La preparación inicial no consultó ni modificó Supabase/Coolify remoto. Tras la autorización A se concilió el catálogo real post052, se verificó un respaldo nuevo y se aplicaron las cinco funciones. La comprobación detectó grants service_role heredados de default privileges: se cerraron solo en estas cinco funciones, sin modificar defaults globales. La regresión reproduce esa herencia, comprueba la corrección idempotente y bloquea drift de propietario/fuente. evidence/production-sql-postflight.json confirma fuentes y ACL finales;391 funciones previas,9 relaciones y2 triggers conservados. Auth/PostgREST con sesión real y build Docker quedan para el postflight de publicación.

No se ejecutó Bouncer, Gmail, Composio ni se enviaron mensajes reales. Las llamadas y activaciones del navegador fueron exclusivamente simuladas; pruebas SQL crean solo registros ficticios en memoria. El WIP del coordinador y los frentes Connect/worker se conservaron.

evidence/integration-checks.json registra48/48 pruebas en la base90a95ce, incluyendo API/base de datos/dispatcher de correo manual; tipos/build exit0. El endurecimiento de permisos no cambia código de UI ni cuerpos de función SQL. Promoción y reversa en rollout.md. Sin aprobación de campaña, créditos Bouncer o envíos como parte de la publicación.
