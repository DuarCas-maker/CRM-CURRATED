# Verificación

Estado: G0–G5 locales completados. G6/publicación fuera del alcance autorizado. Fecha 2026-11-12.

Baseline anterior al cambio: 24/24 pruebas en operations, financing-control, lender-management y unsaved-changes; Node 24.19.0 disponible aunque el proyecto requiere Node 22. No se confunde con validación del delta. Intento de abrir HTML original por navegador bloqueado por política de URL local; código/CSS/JS inspeccionados.

## Resultado y archivos

Módulo aditivo `/pipeline-os`, demo `/pipeline-os/demo` y GET `/api/pipeline-os`. Se conservan Conversaciones, expediente, campañas y sus acciones. El único archivo existente cambiado es `src/components/crm.tsx`, exclusivamente para el acceso adicional con protección de cambios. Nuevos archivos en `src/components/pipeline-os`, rutas nuevas, `src/lib/pipeline-os/{module,demo}.ts`, dos lectores HTTP/server, cinco archivos de prueba y tipografías locales con licencias. `manifest.json` registra hashes de los 24 archivos del payload (incluye pruebas/assets y el shell modificado; excluye documentación).

Los cuatro documentos release que ya estaban sin seguimiento al empezar se conservaron. No se editaron otros checkouts, fuentes S01/F2/F3, SQL, worker, componentes de Conversaciones, modelos compartidos, manifests o lockfile. No se leyó ni copió `.local`, credenciales, contadores privados o env reales para el QA aislado.

## Comandos y resultados observados

Runtime de validación: Node 22.23.5 portátil, descargado de nodejs.org y verificado con SHASUMS256 oficial. Ubicación temporal `C:\Users\Usuario\AppData\Local\Temp\pipeline-os-qa-kWoKUi\node-v22.23.5-win-x64\node.exe`. No instalación global ni dependencias nuevas del proyecto.

| Verificación | Resultado |
| --- | --- |
| `next typegen` con Node 22 | Correcto; tipos de rutas generados. |
| `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | Correcto; sin diagnósticos. |
| Suite seleccionada, comando siguiente | **80/80** correctas, 0 fallos/omisiones; 17 propias y 63 de regresión. Ejecución final de 19,7 s. |
| `prettier --check` en los 18 archivos nuevos TS/TSX/CSS de aplicación/tests | Correcto. |
| `git diff --check` | Correcto. |
| `node scripts/prepare-pdf-viewer.mjs`, en copia aislada | Correcto; assets de visor preparados. |
| `next build --webpack`, Node 22, copia aislada final | Correcto: compilación, TypeScript, generación de 49 páginas estáticas, optimización y trazas standalone. Rutas nuevas presentes. |
| Smoke local | Demo 200; fuente WOFF2 200/firma `wOF2`; API sin sesión 401; filtro inválido 400. La página protegida usa redirección Next en respuesta transmitida, no se acredita un 307 HTTP. |
| Patrones de secreto en texto del payload | 0 coincidencias con clave OpenAI/clave privada; no sustituye auditoría general de secretos. |
| Env en la copia de build | Ningún archivo `.env*`; solo valores sintéticos para configuración del QA. |

Comando de la suite, desde el repositorio (PowerShell; `$qaNode` es la ruta anterior):

```powershell
& $qaNode --import tsx --test --test-reporter=spec --test-concurrency=2 tests/pipeline-os-module.test.ts tests/pipeline-os-module-pagination.test.ts tests/pipeline-os-module-http.test.ts tests/pipeline-os-module-ui.test.ts tests/pipeline-os-module-db.test.ts tests/operations.test.ts tests/financing-control.test.ts tests/lender-management.test.ts tests/unsaved-changes.test.ts tests/opportunity-signals.test.ts tests/mail-chat.test.ts tests/lender-conversations.test.ts tests/conversation-threads.test.ts tests/campaign-center.test.ts tests/campaign-delivery.test.ts tests/lead-preparation-tracking.test.ts tests/underwriting-compact.test.ts
```

Build final en `C:\Users\Usuario\AppData\Local\Temp\pipeline-os-qa-kWoKUi\build`, con source/public/scripts/worker/tests, manifests y configuración del checkout y junction a sus dependencias existentes. No se copió env. Node 22 ejecutó `node_modules/next/dist/bin/next build --webpack`. Se eligió webpack explícitamente para esta validación; no se afirma haber ejecutado el build predeterminado con Turbopack.

## Evidencia funcional y visual

| AC | Resultado local y evidencia |
| --- | --- |
| AC-001 | Rutas nuevas compiladas; diff del CRM solo añade acceso; no reemplazo de sus vistas. |
| AC-002 | Navegador: árbol abierto/cerrado, niveles 1/2, filtros, comparación expandida, expediente con pestañas. Shift+Tab permanece en diálogo; Esc cierra conservando la lista. Anchos CSS medidos: **360, 768, 1280**. Documento sin overflow horizontal en inicio y Conversaciones móvil; tablas con scroll propio. Temas claro/oscuro e idioma ES/EN observados. |
| AC-003 | Filtros antes de paginar sobre 123 registros; total de campañas sobre 713 filas; contrato firmado no inferido de la aplicación; proceso histórico y renovación nueva probados. Progreso mínimo 5 y duplicados documentales probados. |
| AC-004 | Apertura del expediente y UW existentes; pestañas y revisión humana conservadas. No se ejercitó el proveedor IA real. |
| AC-005 | Navegador: 2 hilos independientes en Lenders de Harbor Demo Market (fixture). Regresión de hilos/recipients/BCC y señales confirmadas; caso unitario con contador de 40 lenders. Sin modificar Conversaciones. |
| AC-006 | Navegador: selección humana demo de $55K frente a mayor monto de $75K; plazo/costo/requisitos desplegados. Vencidas, descartadas y ofertas de otro proceso excluidas por tests. |
| AC-007 | Preparación de leads y centro de campañas originales visibles. Selección de 1 lead → diálogo separado de verificación → cancelación; no se consumió proveedor. Regresión de elegibilidad, bajas, cupos y programación correcta. |
| AC-008 | Updates con ventana 24/48 h, 7/30 días, fecha/fuente y próximas 3 acciones. Texto explícito de que no es un nuevo barrido Gmail. |
| AC-009 | HTTP 400/401/403/503 y error genérico 500 probados; no-store. Catálogo contra esquema SQL real en PGlite con seller, closer y ajeno. Paginación con cap 127, lectura incompleta, cambio de count e IDs repetidos fallan de forma explícita. Sin service_role en el lector. |
| AC-010 | `operating-guide.md`, ADR, rollout/rollback, manifest y esta evidencia. |

Captura final con datos ficticios: `C:\Users\Usuario\.codex\visualizations\2026\11\12\01a1d0c9-e4a5-7780-bb5a-9a8605689178\pipeline-os-desktop.jpg`. Las capturas móvil/tablet se observaron durante la sesión. El override de viewport se retiró. Servidor temporal de preview cerrado al terminar, sin parar servicios del usuario.

## Hallazgos resueltos y límites

- Se distinguieron procesos/ofertas actuales de los históricos y se mantuvo activa una renovación enviada sin duplicar el fondeo registrado.
- Se reutilizó progreso documental en vez de contar filas, se completó la lectura de campañas y metadatos y se rechazaron cambios/repeticiones durante paginación.
- La lista anterior se oculta mientras llegan otros filtros; el resultado guardado no se transforma en envío fallido si falla el GET posterior; errores visibles también en diálogos; búsqueda protegida durante hidratación.
- El dataset demo original tenía un correo de lender coincidente con una dirección de equipo. El fixture del módulo usa dos lenders ficticios distintos, verificando el comportamiento original sin cambiar sus reglas.
- Durante edición en caliente se observó estado antiguo incompatible con un campo añadido al snapshot. La recarga limpia permitió el recorrido final; el build frío y las pruebas de render usan la forma actual. No se ocultan errores de producción con fallback demo.
- Los primeros intentos de build de la copia temporal fallaron por no haber incluido worker/tests. Se completó la copia, sin modificar fuentes para omitir checks, y los builds finales finalizaron correctamente.

No se ejecutó toda la suite del repositorio ni una auditoría WCAG automatizada/nativa de lector de pantalla. No se validaron proveedores/buzones reales, envíos, presupuesto IA/verificación, piloto externo, PostgreSQL nativo, push, deploy, migraciones o arranque del worker. Se reutilizan sus capacidades actuales; este módulo no completa SMS/TextTorrent ni autonomía pendiente. El catálogo sigue siendo observacional entre fuentes y tiene límite explícito de 100.000 filas por lectura. La publicación requiere su proceso y autorización posteriores.

Revisión propia con `safe-code-review`: permisos, corrección, datos, idempotencia, compatibilidad y alcance revisados; sin hallazgos locales abiertos que bloqueen este delta. Esto no acredita un release productivo.
