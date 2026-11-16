# Verificación — Usuarios

STRICT · rama codex/s00-auto-receive · 2026-11-16

## Línea base

Descubrimiento de solo lectura completado. WIP ajeno en documentos Pipeline OS/importación histórica y módulos/tests de historical-import conservado. Los archivos de producto rastreados estaban limpios al iniciar. No se abrieron `.env`, contadores ni datos reales. El runtime inicial era Node 24.22.1; la verificación final usa Node 22.23.5 portátil oficial, descargado en `.local/user-management/tools` y verificado contra SHA-256 oficial. Sin cambios a manifests/lock ni instalaciones globales.

## Matriz

| FR     | AC             | T             | Tests / estado                                                                                                                                          |
| ------ | -------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001 | AC-001/010/011 | T-001/002/003 | Cumple local: HTTP/DB con todos los roles, AAL1/AAL2, inactivo/anon y render                                                                            |
| FR-002 | AC-002/003     | T-002         | Cumple local: Auth ficticio, UUID estable, alta directa/replay/timeout/finalización fallida; Auth real pendiente                                        |
| FR-003 | AC-004         | T-001/003     | Cumple local: búsqueda literal y listado metadata-only, contrato paginado, render                                                                       |
| FR-004 | AC-005         | T-001/003     | Cumple local: SQL real en PGlite, conflicto/propio; controles propios deshabilitados observados                                                         |
| FR-005 | AC-006         | T-002         | Cumple local con Auth ficticio/validación/auditoría; contraseña real no modificada                                                                      |
| FR-006 | AC-007/010     | T-001/002     | Cumple local: cifrado real, contexto/alteración/clave fallida, versiones/NULL/ACL                                                                       |
| FR-007 | AC-008/011     | T-003         | Cumple en fixture de navegador: abrir sin descarga, mostrar/ocultar/copiar/guardar/cerrar, teclado; retorno asincrónico invalidado al ocultar/desmontar |
| FR-008 | AC-009         | T-001/002     | Cumple local: auditoría sin contenido/huellas, fallo previo bloquea cambio de contraseña                                                                |

## Checks ejecutados

En los comandos siguientes `NODE22` representa `.local/user-management/tools/node-v22.23.5-win-x64/node.exe`.

| Check                                                | Comando                                                                                                                                                                                                                                                                                                                                                                 | Resultado                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-001 — feature + compatibilidad de catálogo/Auth | `NODE22 --import ./tests/offline.mjs --import tsx --test tests/user-management-database.test.ts tests/user-management-http.test.ts tests/user-management-service.test.ts tests/user-management-ui.test.tsx tests/pipeline-os-catalog-permissions.test.ts tests/pipeline-os-mail-runtime-auth-compat.test.ts tests/pipeline-os-composio-verification-setup-http.test.ts` | 59/59 correctos; log local targeted-node22.log                                                                                             |
| TEST-002 — fuentes finales, Usuarios y CSP           | `NODE22 --import ./tests/offline.mjs --import tsx --test tests/user-management-database.test.ts tests/user-management-http.test.ts tests/user-management-service.test.ts tests/user-management-ui.test.tsx tests/content-security.test.ts`                                                                                                                              | 13/13 correctos; final-targeted-node22.log                                                                                                 |
| TEST-003 — tipos                                     | `NODE22 node_modules/typescript/bin/tsc --noEmit --incremental false`                                                                                                                                                                                                                                                                                                   | Correcto                                                                                                                                   |
| TEST-004 — compilación sin env/credenciales          | `NODE22 scripts/verify-user-management-build.mjs`                                                                                                                                                                                                                                                                                                                       | Correcto, Next 16.3.8 webpack, 51 páginas estáticas y ruta /api/users incluida                                                             |
| TEST-005 — smoke HTTP del build                      | `NODE22 scripts/verify-user-management-smoke.mjs`                                                                                                                                                                                                                                                                                                                       | 4/4: login 200, demo de producción 404, GET users sin configuración 503, POST origen ajeno 403; API private/no-store. Cero llamadas reales |
| TEST-006 — regresión general                         | `NODE22 scripts/run-tests.mjs`                                                                                                                                                                                                                                                                                                                                          | 1.570 pruebas: 1.558 correctas, 4 fallos basales reproducidos, 8 omitidas; 465 s; full-suite-node22.log                                    |
| TEST-007 — formato/diff                              | Prettier check de archivos propios; `git diff --check`                                                                                                                                                                                                                                                                                                                  | Correctos                                                                                                                                  |
| TEST-008 — revisión segura                           | Diff completo de los cuatro archivos existentes modificados y lectura de módulos/SQL nuevos                                                                                                                                                                                                                                                                             | Sin hallazgos de seguridad pendientes; corregidos reintentos de alta, snapshots del modal y encabezado efectivo en Next                    |

Los logs extensos están en `.local/user-management`, ignorados por Git; la evidencia pública compacta está en `evidence/local-checks.json` y `evidence/anonymous-smoke.json`.

## Regresión y línea base reproducida

No se relajaron pruebas históricas para ocultar fallos:

1. `tests/connections-ui.test.tsx`: loader de Node rechaza `connections-workspace.css`. Reproducido con fuentes de HEAD en copia aislada, Node 22 (`baseline-connections-node22.log`).
2. `tests/pipeline-os-case-progress-ui.test.tsx`: mismo problema de loader con `case-progress.css`. Reproducido en copia HEAD (`baseline-case-progress-node22.log`).
3. `pipeline-os-mail-runtime-release.test.ts`, MR02/05: espera una CSP sin `dashboard.composio.dev`, pero la configuración HEAD ya lo incluye. La aserción exacta sobre la configuración HEAD también falla (`baseline-csp-node22.log`). La nueva regla de caché de Usuarios no modifica CSP.
4. `pipeline-os-s02-block-b-ui.test.ts`: exige `<InstantlyTrialControl` en `integrations.tsx`, ausente en HEAD. La misma aserción falla sobre la copia HEAD (`baseline-b1-ui-node22.log`). No se modifica esa integración.

Primera regresión de desarrollo con Node 24 interrumpida al detectar que introducir 054 en `supabase/migrations` alteraba la base47 reproducible. Se corrigió empaquetando 054 junto a su spec, siguiendo 048–053. Catálogo y compatibilidad Auth pasan después (59/59 con Node 22). Primer build aislado falló porque faltaba copiar `worker/mime`; corregido el verificador de build, sin iniciar worker.

## QA de interfaz

Fixture `node scripts/preview-user-management.mjs`, sin env/DB/proveedores y con fetch interceptado en memoria. Observado en navegador:

- Lista con nombres largos, estados y formularios etiquetados; formulario de alta con confirmación de contraseña; controles propios de rol/estado deshabilitados.
- Lecturas privadas en DOM del contador: 0 al abrir; suben solo al mostrar/copiar. Copiar muestra éxito manteniendo máscara. Guardar un reemplazo ficticio muestra éxito y vuelve a ocultar. Cierre tras solo consultar no pide descartar cambios; se corrigió un falso positivo del snapshot nativo de Modal.
- Pestañas operables con teclado (`End` selecciona Texto privado y mueve foco), foco visible y diálogo nativo existente. Estados de error recuperable y vacío observados. La lógica de carga anuncia estado y bloquea acciones.
- Anchos CSS efectivos 360, 768 y 1280 comprobados en DOM, sin desbordamiento horizontal; capturas en `evidence/`. La captura de 1280 está limitada por la superficie visible del navegador anfitrión; móvil/tablet y diálogo final se capturaron completos. No se afirma una auditoría WCAG completa.
- Vista final: `evidence/private-final.jpg`; datos siempre ficticios. Vista y servidor temporales cerrados, override de viewport restablecido. No se modificaron credenciales reales desde navegador.

## Archivos y decisiones

Nuevos: contratos/servicio/HTTP/ruta `/api/users`, pantalla/estilos de Usuarios, cuatro suites de tests y fixture, tres verificadores locales y este paquete SDD/SQL/evidencia. Existentes: `src/components/crm.tsx` (navegación), `src/app/layout.tsx` (CSS), `src/lib/server/supabase.ts` (fetch opcional con timeout), `next.config.ts` (caché específica). No hay dependencias nuevas ni cambios en worker, migraciones históricas o paquetes sellados.

Rollback y activación: `rollout.md`. Revisión de documentación oficial usada para Auth: [createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid); capacidad `id` comprobada además en tipos locales del SDK 2.117.2. Convenciones Next consultadas en su documentación instalada.

## No ejecutado / límites

SQL remoto, Auth real/versión GoTrue de destino, configuración real de cifrado, datos de clientes, push/merge/despliegue: fuera de autorización. Debe hacerse smoke con usuarios QA antes de activación real; el GET anónimo 503 local se debe a la ausencia deliberada de configuración, no es una prueba de login real. Tipos generados de Supabase: no aplica, el repositorio no usa tipos DB generados. La UI conserva el intento incierto solo mientras permanece abierto el formulario; si se cierra después de un timeout, revisar identidad Auth/perfil antes de repetir un alta. Los cuatro fallos basales quedan abiertos fuera de este alcance. G0–G5 local cerrados con estas limitaciones; G6/publicación no ejecutado ni autorizado.
