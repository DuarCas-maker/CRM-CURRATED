# B2 — guardas de envío implementadas y probadas localmente

31/10/2026 · SDD STRICT · Autorización: implementar/probar B2 offline, conservando Gmail directo, Composio deshabilitado e Instantly43. Clarificación y diseño reutilizados de S01 y B; concreciones previas en [b2-local.md](b2-local.md). **Implementación funcional local; promoción y QA visual pendientes.** No equivale a habilitación del entorno ni cierre de S02/S00.

## Resultado y alcance

La preparación de correo/campaña exige confirmar marca y revisiones de cuenta. El servidor deriva actor/MFA, membresía, permiso de remitente, propósito y expediente; registra un snapshot inmutable. Borradores no autorizan un envío por guardarlos. Revisión pendiente/obsoleta o SQL ausente cierra el envío antes de firma/transporte; la lectura histórica legítima conserva A.

Scheduler y notificaciones pasan por las mismas fronteras de procedencia. La notificación usa su registro/destino/preferencia reales y una autorización de sistema, sin tomar prestado un superadmin. La campaña de prueba sigue dirigida únicamente al operador. Lectores y metadatos de cupo se filtran por ámbito antes de agregados/paginación; el histórico expone solo etiqueta mínima con procedencia, sin convertir una cuenta actual en prueba de atribución pasada.

Claim revalida; el hook final registra una admisión única por claim después de reservar cuota. Revocación anterior impide el POST simulado; posterior no borra un intento ya admitido. Timeout/crash/vencimiento exige conciliación y no libera otro envío. Una cuota rechazada de forma conocida conserva el backoff y requiere nuevo claim/revalidación. La conciliación conserva el Message-ID y la autorización original, incluso si el actor fue revocado después del corte.

Se modificaron25 archivos existentes y añadieron siete, incluido un fixture compartido y el [SQL candidato](migrations/b-brand-delivery.local.sql), sin número final. Dos rutas del techo de27 existentes se conservaron sin cambios B2: lectores de campaña y mensajes ya componen las guardas mediante SQL/DTO existentes. [Inventario y huellas](b2-implementation.json), [manifiesto autorizado](manifest.json). No hay dependencias nuevas ni cambios a001–047.

## Trazabilidad y evidencia

| FR / AC          | Verificación ejecutada                                                                                                                                                                                      | Resultado / límite                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| FR07, AC07       | Preparación ausente/adulterada/obsoleta/AAL1; snapshot de actor/revisiones/área; borrador normalizado; reply de otra marca; revisión explícita de campaña con recibo/auditoría/replay.                      | Correcto con SQL real en memoria y sesión ficticia. Sin inferir marca o abrir configuración desde histórico.              |
| FR08, AC08       | Roles operativos y superadmin, membresía y remitente separados del área; firma y hook antes de red; campaña/test/activación; filtros de lectores y acceso directo a presupuestos ajenos.                    | Correcto offline. Se conservan controles039/043, cuotas y negativos de A.                                                 |
| FR09, AC09       | Inserción de servicio sin contexto o con snapshot fabricado; scheduler autorizado; test solo al operador; notificación real/ausente, destino/preferencia/procedencia, claim y revocación antes de admisión. | Correcto en memoria; sin superadmin ficticio ni envíos reales.                                                            |
| FR10, AC10       | Revocación antes/después del corte, claim/token errado, doble admisión, crash/vencimiento, uncertain, cuota conocida y segundo claim; borrar/recrear permiso no reinicia revisión.                          | Correcto con barreras lógicas y HTTP falso. No certifica contención o deadlocks con conexiones PostgreSQL independientes. |
| FR11, AC11       | Legacy detenido sin rellenar brand; contenido/Message-ID intactos; etiqueta histórica mínima y snapshot inmutable; restauración de membresía no reanima intención previa.                                   | Correcto. No se migró ni recatalogó información real.                                                                     |
| FR05/12, AC05/12 | SSR ES/EN en correo/campañas/legacy; SQL con marcador, RLS/grants/aliases y rollback; composición con fachada/worker/firma/adjuntos falsos; preservación I01/B1/046/047/privados.                           | Correcto local. QA visual/teclado/responsive y empaquetado completo pendientes.                                           |

Pruebas finales: **118/118** según Node, incluidos grupos padre:32 en los tres archivos B2 nuevos,12 de composición/envío afectada y74 de regresión seleccionada, que incluye las30 B1. No se atribuyen aquí los155 históricos de A ni se repitieron pilotos reales S00/PRUEBA/Bouncer.

Comandos desde la raíz con Node22 del repositorio:

```powershell
$node = '.local/toolchains/node-v22.23.4-win-x64/node.exe'
& $node --experimental-test-module-mocks --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-concurrency=3 tests/pipeline-os-s02-block-b-snapshots.test.ts tests/pipeline-os-s02-block-b-dispatch.test.ts tests/pipeline-os-s02-block-b-composition.test.ts tests/campaign-attachments.test.ts tests/document-package-delivery.test.ts tests/mail-forward.test.ts tests/mail-send.test.ts tests/pipeline-os-s01-mail-permissions-api.test.ts tests/pipeline-os-s02-block-a-api.test.ts
& $node --experimental-test-module-mocks --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-concurrency=3 tests/request-origin.test.ts tests/unsaved-changes.test.ts tests/mail-editor-compatibility.test.ts tests/mail-manager.test.ts tests/mail-channels.test.ts tests/workspace-mail.test.ts tests/workspace-mail-files.test.ts tests/workspace-errors.test.ts tests/campaign-center.test.ts tests/campaign-readiness.test.ts tests/campaign-delivery.test.ts tests/campaign-migration-compatibility.test.ts tests/pipeline-os-s02-block-b-admin.test.ts tests/pipeline-os-s02-block-b-api.test.ts tests/pipeline-os-s02-block-b-ui.test.ts
& $node --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

El preload de QA bloquea fetch/http/https/socket/TLS/DNS; las suites instalan servicios falsos acotados. PGlite en memoria ejecuta001–047+A+B1+B2 y rollback, sin iniciar web/worker. Las pruebas nuevas pueden usar el runner normal del proyecto; el módulo de mocks también dispone de proceso hijo aislado. Ningún comando carga env reales.

TypeScript, Prettier de fuentes/tests/documentos afectados y diff-check correctos. No hay script lint configurado; SQL se valida ejecutándolo en PGlite. No se repitió el empaquetado standalone conocido con EPERM Windows ni se presenta como aprobado por pasar tsc. La revisión visual de B1 ya había fallado al iniciar los navegadores locales; B2 solo acredita SSR, no capturas, foco o teclado.

## Revisión y correcciones

Revisión propia en modo revisión: permisos, errores, procedencia, aliases públicos, idempotencia, lock order y conservación de consumidores/negativos. Hallazgos corregidos dentro de B2:

- Wrapper SQL renombrado conservaba un calificador de parámetro del nombre original; creación de campaña cubierta funcionalmente y alias materializado con el nombre efectivo, sin editar B1 ni migraciones históricas.
- La respuesta legacy no mostraba selección de marca; ahora también requiere revisión. Cambiar cuenta o expediente limpia la confirmación anterior. Comparación de preparación por campos, sin depender del orden de claves JSONB.
- Presupuestos directos y aliases heredados quedaron cerrados por ámbito/grants. Dos SHARE previos a promoción podían enfrentarse; contexto de expediente adquiere UPDATE desde el inicio y conciliación sigue la jerarquía antes de outbox. Recorridos multi-cuenta ordenados por marca/cuenta.
- Tres positivos antiguos del editor carecían de marca revisada; solo se adaptó su fixture y se añadieron negativos sin revisión. Todas las aserciones anteriores se conservaron.

No quedan fallos confirmados abiertos en lo probado. Límites: PostgreSQL real multiconexión, QA visual y build completo; no prometer atomicidad entre la DB y Gmail o retirada de un intento ya admitido.

## Preservación y siguiente bloque

Auditoría sobre baseline600 archivos: ocho I01,13 B1 fuera del path compartido actions,47 migraciones y49 JSON operativos intactos. HEAD fb9f201 conservado; no env leídos, APIs, envíos, verificación paga, commit/push/deploy o SQL remoto. **Instantly43 consumidas/0 nuevas. Gmail directo sigue fijo, Composio sin selector productivo.**

Siguiente incremento de producto: **C, asociación técnica revisada de cuentas Composio**, todavía sin activarlo. Antes de promoción conjunta: catálogo/Storage/legado/versiones T00-02-I, asignaciones reales revisadas, PostgreSQL multiconexión, QA visual/teclado y empaquetado compatible. B1/B2 no se publican automáticamente por terminar estas pruebas.
