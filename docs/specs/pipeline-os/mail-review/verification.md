# Verificación

Alcance local con datos ficticios y proveedor simulado; sin APIs reales de Gmail/Composio/OpenAI, env reales, cambios de cuentas o migraciones remotas. El estado de cuentas de spec.md fue observado en la UI autenticada; no acredita vigencia de tokens Gmail.

## Entorno y resultados

Node 22.23.5 portátil ya disponible, Next 16.3.8, dependencias existentes. Sin instalaciones. Runtime del shell inicial Node24: las comprobaciones de entrega se repitieron en Node22. QA aislada en `C:/Users/Usuario/AppData/Local/Temp/pipeline-mail-review-qa-681c84b304/`, con solo fuentes públicas y enlace a dependencias; sin env ni credenciales. Los procesos QA tienen entorno explícito y solo escuchan en loopback; no se arrancó el worker.

| Comprobación | Comando / evidencia | Resultado observado |
| --- | --- | --- |
| Suite completa | Node22 `scripts/run-tests.mjs --test-reporter=tap` | 1442 tests: 1436 aprobados, 0 fallos, 6 omitidos (opt-in existente). `full-suite-release.tap` en QA. |
| Nuevos contratos/DB/proveedor | Node22 `--import ./tests/offline.mjs --import tsx --test --test-reporter=spec tests/pipeline-os-mail-review.test.ts` | 15 aprobados. Incluye instalación/reversa/reinstalación, aprobación atómica, fuente corregida/reanálisis, intento tardío, roles/MFA/inactivo, paginación y permisos integrados A/B. |
| Regresión después del ajuste final de recuperación | Mismo runner con `pipeline-os-mail-review`, `pipeline-os-module*` y `ai-usage` | 36 aprobados, 0 fallos, 0 omisiones. |
| Tipos | Node22 `node_modules/typescript/bin/tsc --noEmit` | Aprobado. |
| Build | Node22 `next build --webpack` en copia sin env | Aprobado; 50 páginas y nueva ruta API. Log QA `qa-build-complete.log`; comprobación del último ajuste registrada al cerrar. |
| Diff | `git diff --check` | Aprobado. |
| Interfaz | Navegador real, demo local | 360/768/1280 CSS px; sin desbordamiento de controles. ES/EN; Tab desde importe a producto; cierre con cambios ofrece continuar editando y preserva importe; requisito vacío no aprueba. Oferta corregida a 60.000 USD y requisito se aprueban en demo. Consola del build final sin errores/advertencias observadas. |

La suite completa terminó antes del último ajuste de recuperación de propuestas listas; los 36 checks relacionados y tipos se repitieron después. No se presenta esa mejora como una nueva ejecución de toda la suite. La prueba de base de datos aplica el delta 053 explícitamente sobre la base histórica y después comprueba permisos integrados; no acredita PG15 físico ni contención entre sesiones nativas.

## Trazabilidad

| AC | Evidencia y estado |
| --- | --- |
| AC01 | Asociación manual existente conservada; RPC valida expediente/proceso/evaluación, rechaza otro proceso y solo completa campos ausentes al aprobar. ✅ local |
| AC02 | Proveedor falso, texto nuevo sin citas, schema privado, validación de evidencia literal e importe; no efectos comerciales al analizar. ✅ local |
| AC03 | Validación producto/importe/requisito/owner/fecha en API y DB, controles editables; validación de requisito vacío en navegador. ✅ local |
| AC04 | Oferta o requisito + tarea + actividad/evento/recibo en una transacción; cero outbox y sin modificar estado/firma/fondeo del proceso. ✅ local |
| AC05 | Repetición devuelve IDs; cambio de fuente invalida aprobación; reanálisis explícito archiva intento; CAS y finalización tardía protegidos. ✅ local |
| AC06 | Seller/ajeno/inactivo/AAL1/anon/direct DML/finish autenticado rechazados. ✅ local |
| AC07 | Paginación 20+7 sin repetidos; error/guardado/teclado/idiomas/anchos observados con fuentes ficticias. ✅ local |
| AC08 | Un buzón Daniel registrado, Google directo preparado para organización Curated; alta/check Composio deshabilitados observados sin iniciar OAuth. ✅ lectura UI; cobertura externa pendiente |

## Fallos encontrados y corregidos

- Fixture nuevo: inferencia ambigua UUID/text en INSERT; se explicitaron casts de la fuente ficticia. Tipado del helper de aprobación corregido sin relajar contratos.
- Aprobación: variable de fecha local mal calificada; el ensayo demostró rollback completo. Se corrigió el nombre y pasaron idempotencia y efectos únicos.
- Catálogo histórico: la ubicación inicial de 053 dentro de 001–047 rompía inventarios/hash congelados. Se siguió la convención de paquetes posteriores 048–052 bajo docs/specs; fixtures/manifests originales quedaron intactos. Los 51 checks de executor/inventario/fundación/revisión se repitieron y pasaron, y luego se ejecutó la suite completa sin fallos. El adaptador de catálogo conserva ahora el código PostgreSQL real para verificar ausencia de migración.
- Copia QA inicial: faltaba `worker/mime`, importado por la web. Se completó la selección de fuentes públicas del worker; no se ejecutó ese servicio.
- Revisión final: recuperación de propuesta lista tras cambiar la fuente/asociación; se añadió historial de intentos y nueva acción explícita. Prueba demuestra que el intento previo se conserva y que una finalización tardía no lo reemplaza.

## Revisión del diff y límites

Aplicada `safe-code-review` sobre fuentes nuevas y cambios de integración: autorización antes de IA, RLS, source hash, CAS, transacción, claves fuera del cliente, cuerpo limitado y cero reintento pagado automático. Sin dependencias nuevas ni cambios a manifests de paquetes, lockfile, credenciales o worker. Se preservaron los archivos WIP ajenos. Evidencia visual ficticia en `evidence/`.

Cierre del último ajuste: build Node22 completo nuevamente aprobado, recuperación explícita de propuesta lista observada en navegador sin errores, y nueva aprobación ficticia por 60.000 USD confirmada con campos registrados visibles. Captura `evidence/approved-desktop.jpg` actualizada. El viewport temporal se restauró. Los procesos locales de QA se detienen al entregar; no se dejan workers o servicios remotos iniciados. El manifiesto propio identifica fuentes/documentos/evidencia de esta entrega sin incluir WIP ajeno.

Pendientes de operación: catálogo real/orden 048–053, ensayo PG15 físico, autorización de instalación/publicación y piloto real con presupuesto. No commit, push, merge o despliegue en esta entrega; rollback y guía en esta carpeta.
