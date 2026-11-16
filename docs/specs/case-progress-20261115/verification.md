# Verificación

Resultado local: **50 pruebas correctas, cero fallos, cero omisiones; TypeScript y build Next completos correctos**. Solo datos ficticios, Node `22.23.5`, dependencias existentes mediante junction; sin instalar paquetes ni copiar env/archivos privados. G0–G5 cerrados; G6 pendiente de autorización explícita para este cambio.

| Requisitos / aceptación | Evidencia observada |
|---|---|
| FR-001 / AC-001 | Drawer real de Pipeline OS con fixture: su primer hijo es `pos-case-progress`; IA sin atributo `open`. Captura `evidence/desktop-1280.jpg`. |
| FR-002 / AC-002/003 | Proyección: documentos duplicados/ausentes/no aprobados, exclusión de reportes, flags, extras, límite de fuentes, hash, revisión humana vigente/incompleta/futura/obsoleta y entrega al closer. |
| FR-003 / AC-004/005 | Sin proceso, archivo excluido, último activo, renovación con oferta/fondeo/eventos antiguos y envíos draft/queued/uncertain/withdrawn/futuros. |
| FR-004 / AC-006–008 | selected/accepted y mayor monto separados, vencimientos/rechazos/conflictos, requisitos del elegido, contrato enviado/firmado/aprobación/desembolso independientes y cierres sin financiación. |
| FR-006 / AC-009/010 | RLS simulado con cliente autenticado: 404 indistinguible, acceso antes de metadatos, seller no consulta tablas privadas, filtro de archivo, páginas de una fila, total cambiante/duplicados/error y respuestas 400/401/403/404/503/500 sin caché. |
| FR-005/007 / AC-010/011 | Navegador: acciones a Documentos, Análisis, Lenders y Correo e histórico; estas dos últimas también en el drawer real con foco en `Acciones del expediente`. Enter/Tab/Espacio/Shift+Tab operativos. Error y carga no muestran ceros ficticios; reintento recupera la proyección. |

## Checks ejecutados

- `node .../Curated-Case-Progress-QA-20261115.cjs`: siete suites; 21 pruebas nuevas (12 proyección, 5 lectura/HTTP, 4 UI) y 29 de regresión (tablero, HTTP, UI y revisión de correo). `evidence/tests.json` y `checks.json`.
- TypeScript estricto de fuentes alcanzadas, ruta y tests: salida vacía, exit 0. El build también ejecuta el chequeo completo del proyecto.
- `next build --webpack` aislado: exit 0, 51 páginas estáticas generadas y ruta dinámica de progreso compilada. Variables sintéticas, guard offline y sin archivos `.env` reales. `evidence/next-build.json` y `next-build.txt`.
- Prettier sobre los 13 archivos de producto/tests tocados: correcto. `git diff --check`: correcto. El último ajuste al archivo compartido es únicamente formato de la unión `initialTab` y una expresión contigua; no cambia comportamiento.
- UI en 1280×900, 768×900 y 360×900 CSS: sin desborde horizontal del panel; mediciones y navegación en `evidence/browser-checks.json`. Capturas desktop/tablet/mobile, documentos, riesgo, lenders, cierre, desembolso, desconocido, restringido, error y tema oscuro en esta carpeta. Los screenshots usan datos inventados.

## Revisión del delta

Aplicada la revisión de correctitud, permisos, datos, concurrencia y compatibilidad de `safe-code-review`. Corregidos antes de entregar: exclusión de evaluaciones retiradas sin prueba de envío, fondeo solo con estado actual/monto/lender del proceso, rechazo de revisiones futuras, filtro de expedientes archivados, contador desconocido sin cero ficticio y selección inicial visible al seller. No se encontraron bloqueos adicionales en el alcance revisado.

Nueve archivos de producto: proyección, lector, GET, componente/CSS, composición del drawer y tres ajustes mínimos de consumidores (`CaseSection`, `initialTab`, IA colapsada). Cuatro archivos de fixtures/tests. Sin manifiestos de paquetes, migraciones, workers, credenciales ni acciones de negocio modificadas. El manifiesto de archivos contiene las huellas del candidato local.

## Límites y pendientes

No se ejecutó la API contra Supabase remoto ni se probaron registros de clientes en producción. La verificación de permisos de esta entrega combina guardas de dominio y consultas RLS simuladas; no constituye un nuevo ensayo físico de RLS. No hay cambios SQL: pruebas de migración no aplican. No existe script `lint` en el manifiesto del proyecto.

Las pruebas de navegación reutilizan las acciones existentes y su protección de formularios; no se ejecutaron UW, envíos, asociación real ni importación. Las validaciones financieras del servidor existente no se reemplazan por el checklist. Los documentos/análisis siguen a nivel de expediente y las tres últimas fases exigen proceso activo. Por eso un legado no asociado puede mostrar “Sin verificar” aunque el HTML tenga una etiqueta avanzada.

El tablero y la comparación previa de ofertas conservan su lógica. Este panel reconoce `selected` y `accepted` conforme a las dos acciones existentes; no integra el WIP de dashboard/importación de otros chats. Falta incorporar el histórico con resolución individual de conflictos e IDs de origen; los previews del paquete no son evidencia suficiente para completar pasos.

Sin commit/push/merge/despliegue ni operaciones de proveedores. Rollback disponible en `rollout.md`.
