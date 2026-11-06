# C1 — candidatos Composio implementados y probados localmente

31/10/2026 · SDD STRICT · Implementación C1 autorizada por el usuario, continuación confirmada durante el trabajo. Alcance C-T02–05 y [concreciones previas](c1-local.md); decisiones de negocio C heredadas, sin nueva ronda innecesaria. **C1 funcional local; C2/C3 y promoción pendientes.**

## Qué se entregó

Un path existente modificado, nueve nuevos: sección autocontenida de Configuración, DTO/parsers/errores, helper servidor y ruta GET/POST de cuenta; candidato SQL no numerado; tres suites nuevas y fixture compartido. [Inventario y huellas](c1-implementation.json), [manifiesto](manifest.json). No dependencias nuevas.

Registrar un candidato deriva cuenta/correo/actor/contexto en DB y conserva su tuple inmutable. Head técnico independiente de brand_revision, CAS sobre contexto y revisiones, historial y exclusividad de conexión. Reemplazar conserva el anterior; revocar es solo una operación del CRM, incluso si la cuenta ya no está lista. Replay idéntico no duplica recibo/auditoría; rol/MFA vigentes se comprueban antes de devolverlo.

Las tres tablas tienen RLS y ningún acceso directo para anon/authenticated/service_role; solo dos RPC humanos acotados. No se amplía crm_command, callbacks, worker o transportes. En C1 no existe writer de checks: confirmar sin evidencia falla cerrado, ningún candidato puede pasar a verified/active. El DTO devuelve referencias enmascaradas y errores cerrados, sin claves/SQL/respuestas del proveedor.

Panel ES/EN: selección explícita de cuenta, marca y transporte directo separados, cinco campos con ayuda para distinguir IDs, revisión visible antes de guardar/revocar, protección de cambios sin guardar, 409/503 y estados vacío/carga/readonly/obsoleto. Datos de una cuenta anterior se descartan por generación y por ID; no seleccionar primera cuenta o conexión por defecto. No controles de envío, OAuth, verificación real o activación.

## Trazabilidad local

| FR / AC                      | Evidencia ejecutada                                                                                                                                                                                                                                         | Resultado y límite                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| FR01/12, AC01/12             | Comparación de todas las tablas comerciales existentes salvo recibos/auditoría antes/después de registro/revocación/reemplazo; incluye OAuth, perfiles, marcas, permisos, cola, jobs, histórico y documentos ficticios. Preservación de fuentes/contadores. | Correcto local, sin HTTP/cola adicional o cambio de revisión B2. No operación remota.                        |
| FR02, AC02                   | Cuatro roles operativos, superadmin/AAL1/inactivo/anon/servicio; RPC y DML/SELECT de las tres tablas/helper privado. API sesión/MFA/Origin antes de SQL.                                                                                                    | Denegaciones correctas; superadmin/AAL2 válido puede administrar. No SA prestado ni acceso por service_role. |
| FR03, AC03                   | Body/params/cursor estrictos, actor/email/verified/api_key adicionales y IDs intercambiados rechazados, correo/creador derivados. Cuenta sin marca revisada no registra.                                                                                    | Correcto SQL/API/parser; no IDs reales empleados.                                                            |
| FR04/05, AC04/05             | Conflicto entre dos cuentas con head ausente/existente, rollback del reemplazo fallido; nueva versión y terminal revoked; CAS lógico con un ganador, replay canónico, clave de otro comando CRM y autorización revocada antes del replay.                   | Correcto PGlite; no prueba contención entre conexiones PostgreSQL independientes.                            |
| FR08 negativo, AC08 negativo | Confirmación sin evidencia, estado/identidad fabricados, checks sin writer.                                                                                                                                                                                 | Rechazo cerrado. Positivo de evidencia/aprobación corresponde a C2, no se fabrica para cerrar C1.            |
| FR09, AC09 parcial           | API saneada/no-store/503 sin fallback; historial102 en páginas100+2, cursor ajeno y referencias cortas/largas. SSR0/1/100, ES/EN, campos/ayuda/labels, error/readonly/carga/obsoleto y protección del formulario.                                           | Correcto SQL/API/SSR. Visual360/768/1280, foco/teclado/contraste no acreditados.                             |
| FR11, AC11                   | SQL sobre001–047+A+B1+B2 solo en memoria; marcador obligatorio, rollback íntegro; definiciones/ACL previas idénticas.                                                                                                                                       | Correcto. No migración remota o ordinal final.                                                               |
| FR06/07/08 positivo/10       | Contrato existente C2 y flags cerrados, sin nuevo servicio.                                                                                                                                                                                                 | Pendiente C2; C1 no verifica conexión/proyecto/cuota/grants reales ni renueva evidencia.                     |

## Pruebas y checks

**24/24 pruebas C1** según Node, incluidos grupos padre:14 SQL, seis API y cuatro parser/UI. **73/73 regresión seleccionada**: B1/B2 administración/API/UI/snapshots/despacho/composición más request-origin y unsaved-changes. Total de estas selecciones97/97; no sumar los118 históricos de B2 o el wrapper repetido del runner normal.

Comandos desde la raíz:

```powershell
$node = '.local/toolchains/node-v22.23.4-win-x64/node.exe'
& $node --experimental-test-module-mocks --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-s02-block-c-bindings.test.ts tests/pipeline-os-s02-block-c-api.test.ts tests/pipeline-os-s02-block-c-ui.test.ts
& $node --experimental-test-module-mocks --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-concurrency=3 tests/pipeline-os-s02-block-b-admin.test.ts tests/pipeline-os-s02-block-b-api.test.ts tests/pipeline-os-s02-block-b-ui.test.ts tests/pipeline-os-s02-block-b-snapshots.test.ts tests/pipeline-os-s02-block-b-dispatch.test.ts tests/pipeline-os-s02-block-b-composition.test.ts tests/request-origin.test.ts tests/unsaved-changes.test.ts
& $node --import './.local/pipeline-os/s02-i01/offline.mjs' node_modules/typescript/bin/tsc --noEmit --incremental false
& $node --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-s02-block-c-api.test.ts
git diff --check
```

Preload bloquea fetch/http/https/socket/TLS/DNS; SQL PGlite en memoria, Supabase/cookies falsos en rutas reales. El archivo API también pasó con el runner sin flag de módulos: su wrapper ejecuta los mocks en un proceso hijo propio, sin dependencia de QA privado para el test normal. No se iniciaron web/worker reales ni se cargaron env reales.

TypeScript `tsc --noEmit --incremental false` correcto. Formato Prettier/diff-check correctos; no script lint configurado. Sintaxis/constraints/permisos SQL validados por ejecución, no por formatter SQL. Se corrigieron el primer error de sintaxis FOREACH y anotaciones de los fixtures detectadas por TS antes de los resultados finales; ningún test se omitió o relajó.

Fixture de navegador compilado con esbuild ya instalado vía tsx, sin dependencias nuevas: `.local/pipeline-os/s02-c1/visual.html`, JS/CSS y datos ficticios; mock local de CRM, CSP connect-src none. **Compilarlo no equivale a verlo**. No se repitió el arranque de navegadores ya limitado en B1 (timeout/Crashpad) ni se declara QA visual/teclado aprobada. Build standalone Next completo sigue pendiente por EPERM Windows heredado; no se ejecutó Next CLI sobre env reales para intentarlo de nuevo.

## Revisión propia y conservación

Modo revisión: nuevo código/SQL/tests completos y diff del único compartido, con foco en permisos, fuente de identidad, replay, errores, atomicidad y carreras de UI. Ajustes confirmados: cerrar guard nulo sin actor, separar validación JSON objeto de sus keys, manejar400/413 sin detalle privado, exigir MIME JSON exacto y descartar respuestas previas al cambiar/limpiar cuenta. Sin fallos confirmados abiertos en lo probado; pendientes de visual/build/contención reales explícitos.

Huellas finales y alcance en [c1-implementation.json](c1-implementation.json): ocho I01,34 entradas B2,47 SQL históricos y49 JSON operativos anteriores intactos; HEAD fb9f201. Fuentes A/B y WIP previo fuera del único compartido conservados. No checkout S01, env reales, llamadas, envíos, verificaciones pagas, SQL remoto, commit/push/deploy o activación. **Instantly43 consumidas/0 nuevas. Gmail directo activo; Composio deshabilitado.**

Siguiente incremento: **C2, verificador inyectable offline y protocolo de evidencia**, después de revalidar los dos paths C1 compartidos. C3 y gates de publicación permanecen separados. C1 no está desplegado y no completa C/S02/S00 ni habilita una prueba real del proveedor.
