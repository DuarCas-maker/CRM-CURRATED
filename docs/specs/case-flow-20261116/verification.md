# Verificación del candidato local · 16/11/2026

Resultado: implementación local preparada en `codex/case-flow-simplification-20261116`, checkout `CRM-Curated-Case-Flow-20261116`, base `a34a089`. G0–G5 completados. G6 (integración/publicación) no ejecutado ni autorizado para este incremento. El checklist anterior publicado no contiene todavía estas correcciones.

## Evidencia automatizada

- **76/76 pruebas**, 18 archivos: dominio y proyecciones, HTTP, componentes, PGlite con migraciones reales, underwriting, catálogo, composición, destinatarios y compatibilidad de correo. Guardas offline bloquean fetch externo. Sin pruebas omitidas en este conjunto.
- **1/1 prueba PostgreSQL nativo 15.19** (`150019`), clúster propio en loopback, dos sesiones reales: exactamente una selección concurrente confirma y la otra recibe conflicto. Reintentar la misma solicitud no duplica eventos. Instala la base 001–047, materializa las definiciones públicas aceptadas de 049 con datos sintéticos y aplica 055. La reversión conserva eventos/ofertas/montos; reaplicar 055 funciona. Clúster detenido al terminar.
- Compilación Next.js 16.3.8 con webpack y TypeScript: correcta. Node 22.23.5; sin leer archivos `.env` reales. Variables públicas sintéticas y fetch externo bloqueado.
- `git diff --check`: correcto.

Los primeros ensayos detectaron expectativas antiguas de traspaso/envío por estado de solicitud, campos faltantes de fixtures, un tipo de dependencia HTTP demasiado amplio y la diferencia entre rechazo y obsolescencia. Se corrigieron; los resultados anteriores corresponden al candidato final, no a esos ensayos fallidos.

## Matriz FR / AC

| Alcance | Prueba observada |
|---|---|
| FR-01 / AC-01 | Aprobar directamente la tarjeta completa riesgo; No aprobar lo deja pendiente. Un informe rechazado no se describe como desactualizado. Reporte estructurado original conservado; cambios de documentos invalidan aprobación. Uno de varios aprobados basta. |
| FR-02 / AC-02 | Responsable sin traspaso y administradores autorizados; ajenos, MFA insuficiente e inactivos bloqueados. Cambio de responsable revoca al anterior. Nueva evaluación hereda el responsable; preparar correo sin permiso de buzón falla y con permiso queda en cola ficticia, sin worker. |
| FR-03 / AC-03 | Riesgo aprobado sin correo → Pendiente de lenders; `sent` outbound a destinatario exacto → Oferta y negociación sin oferta aún. Cola, incierto, destinatarios ambiguos, fechas inválidas e históricos de otra operación no acreditan envío. |
| FR-04 / AC-04 | A y B coexisten; elegir B conserva A. Una selección por operación. CAS con dos sesiones y solicitudes repetidas. Controles integrados en la conversación y en Lenders del expediente. |
| FR-05 / AC-05 | Monto ofrecido y final acordado separados. Guardar el final mantiene cierre/desembolso pendientes. Cero, negativos, más de dos decimales, evidencia ajena y mezcla de procesos se rechazan. Desembolso requiere importe real y lender. |
| FR-06 / AC-06 | Marcar pendiente con motivo/documento muestra procedencia manual. Volver a automático recupera la evidencia y conserva auditoría. Un conflicto mantiene monto/motivo escritos durante Actualizar estado y permite revisar antes de reintentar. Sin casillas genéricas para inventar informes, selección, oferta o funding. |
| FR-07 / AC-07 | Pruebas regresivas, loading/error, español/inglés, lectura sin mutaciones, separación por operación, responsive y teclado. |

## Revisión visual

Componentes reales en harness local con HTTP simulado y datos ficticios. No se conectó la interfaz a producción ni se llamó IA/Gmail/Composio/Instantly. La persistencia y transacciones se comprobaron por separado con SQL real en PGlite y PG15; la interfaz usó respuestas controladas, no un Supabase remoto.

Recorrido observado: aprobación → primer correo ficticio confirmado → dos ofertas → una seleccionada → requisitos pendientes/resueltos → monto final acordado → cierre aún pendiente. Además: No aprobar, revisión manual, vuelta a automático, conflicto con conservación de campos, guardado móvil y cierre de diálogo por Escape. Consola sin errores al finalizar.

Checklist/análisis sin desbordamiento en **360, 768 y 1280 CSS px** ([medidas](evidence/responsive.json)). Conversaciones y formularios probados también en móvil de 355 CSS px y escritorio; el ajuste de ancho externo del navegador se restableció.

Capturas exclusivamente ficticias: [análisis simplificado](evidence/risk-desktop.jpg), [revisión manual móvil](evidence/manual-mobile.jpg), [gestión de lender móvil](evidence/lender-mobile.jpg). El botón «Simular correo confirmado (QA)» solo existe en el harness de prueba, fuera del producto.

## Reproducción y límites

Pruebas agrupadas y logs locales: `C:/Users/Usuario/Downloads/Curated-Case-Flow-QA-20261116/`; controlador `Curated-Case-Flow-QA-20261116.cjs`. Prueba nativa reproducible con `CASE_FLOW_PGROOT` apuntando a los binarios PG15 ya provistos y `node --import ./tests/offline.mjs --import tsx --test tests/pipeline-os-case-flow-pg15.test.ts`. Tipos: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.

No se ejecutó toda la suite del repositorio, una importación histórica, modelos IA reales, entregas de correo, migraciones remotas ni verificaciones de producción. Falta conciliar el WIP/esquema del coordinador, revisar el diff integrado y autorizar 055 + publicación. Los permisos S01 y la cola se probaron localmente; deben revalidarse contra el esquema remoto concreto al preparar esa publicación. Los archivos ajenos, credenciales y contadores privados se conservaron.
