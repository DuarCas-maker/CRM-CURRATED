# Tareas ABC-FINAL-r1

**AF-EOL-r1 posterior:** EOL-T01–03 implementadas/verificadas: [LF/CRLF y45 pruebas offline](line-endings/verification.md), artefactos/bindings actualizados y guardas conservadas. EOL-T04/ensayo nativo/publicación pendientes; el catálogo posterior al intento fallido está conforme según resultado del operador. No repetir esa lectura ni aplicar049 por estos tests; Instantly43/0 nuevas.

**PG-EXEC-r1 posterior:** [PG-T03 completado offline](pg15-rehearsal/executor-verification.md). Motor/cluster PG-T02 y pruebas nativas PG-T04/05 siguen pendientes; el resto de gates de publicación permanece abierto. Los16 escenarios coordinados con procesos simulados no se registran como16 pruebas nativas. Instantly43/0 nuevas, fuentes aceptadas conservadas.

**04/11/2026 — vigente:** AF-P01/P02 corregidos/preparados y [preflight del operador conforme](preflight/result-review.json); no repetir consulta/048/VR1. AF-P03 se concreta en [AF-PG15-r1 y sus cinco tareas](pg15-rehearsal/tasks.md): protocolo preparado, runtime/ejecutor/ensayo nativo pendientes. AF-T05/publicación y demás controles continúan abiertos. Hoy solo preparación/documentos,0 remoto/0 tests repetidos/Instantly43. Los estados previos se conservan debajo como antecedentes.

Lectura AF-INV-r2 completada por el operador y aceptada: [resultado](inventory-r2/result-review.md),206 firmas exactas y explicación C→JSON/default trazada localmente. No faltantes/adicionales que remediar; una prueba local nueva correcta, sin repetir4/15 anteriores. No repetir consulta/048 o aplicar049 por esta aceptación. AF-T05 y autorización de publicación siguen pendientes.

AF-INV-r2: error de049 reportado antes del DDL, revisión de inventario por conjuntos implementada y4 pruebas nuevas correctas. [Diagnóstico](inventory-r2/bugfix.md). Confirmación del inventario/collation actual pendiente de una lectura autorizada; no replay o cambio remoto. AF-T05/publicación siguen abiertos y los15 tests de preparación conservan su fecha/alcance anterior.

| T      | FR / AC          | Trabajo                                                                                  | Estado inicial                                                                                   |
| ------ | ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| AF-T01 | FR01/02, AC01/02 | Congelar fuentes y derivar contrato del delta sobre base posterior a048.                 | Preparado: contrato, variantes PD-R1 y matriz de70 funciones revisados.                          |
| AF-T02 | FR01/03, AC01/03 | Generar 049 atómico y ACL explícitas acotadas.                                           | Preparado y aplicado solo en memoria con defaults amplios.                                       |
| AF-T03 | FR04/05, AC04/05 | Generar postflight y protocolo de cutover/recuperación/presupuesto.                      | Preparado; dos scripts futuros, hasta un ROLLBACK condicional separado,0 remoto.                 |
| AF-T04 | FR01–06, AC01–06 | Probar artefactos exactos offline, negativas/rollback/preservación y auditar manifiesto. | 15/15 nuevas y TypeScript correctos; manifiesto de conservación. Pilotos aceptados no repetidos. |
| AF-T05 | FR02/05          | QA independiente PG15/concurrencia, visual/build y controles operativos existentes.      | Gate de publicación pendiente; fuera de ejecución de este incremento.                            |

No push, SQL remoto, deploy o activación autorizado por estas tareas.

## AF-PRE-r1 — 02/11/2026

PRE-T01 y PRE-T02 implementadas: excepción previa acotada de vista y preflight completo de solo lectura. PRE-T03: pruebas y conservación documentadas en [verificación](preflight/verification.md). La lectura del operador y todos los gates AF-T05 siguen pendientes. [Especificación y aceptación](preflight/spec.md). No reejecutar049/048 ni el diagnóstico dedicado de inventario.
