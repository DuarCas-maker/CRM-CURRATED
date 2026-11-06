# Tareas S02-I01 y siguiente integración

**05/11/2026 — pendiente explícito S02-CONNECT-T01:** [alta Gmail–Composio desde el CRM y reparto paralelo](../parallel-roadmap-20261105.md). Por preparar: discovery/SDD del botón, consentimiento por cuenta, retorno/identidad, cuenta nueva o existente, cancelación y reconexión idempotente. No está implementado ni se confunde con el registro de bindings ya preparado. La activación del transporte queda en R06/T02-03/04, separada del alta. 049 y catálogo ya aceptados; candidato web/worker preparado, sin publicación. Gmail directo sigue activo, Composio deshabilitado e Instantly43. Sin transferencia de archivos a otro chat por este registro.

31/10/2026 · Plan por entregables/dependencias, sin fechas prometidas. [Spec](spec.md), [diseño](design.md), [aceptación](acceptance.md).

| ID | Objetivo y requisitos | Dependencias | Terminado cuando | Verificación | Estado |
|---|---|---|---|---|---|
| S02I01-T01 | Revisar S01, fachada/consumidores y base aceptada. FR01/03/08 | Solicitud actual y documentos públicos | Estado local/integrado diferenciado, propiedad y superficies afectadas identificadas. | Manifiestos/huellas y entrega del chat, sin repetir tests. | Completada para preparación |
| S02I01-T02 | Definir contrato, errores, AC y límite de implementación. FR01–08 | T01 y decisiones existentes | Especificación, diseño, ADR, tareas y aceptación trazables; selección productiva Composio excluida. | QA documental y revisión del contrato contra código observado. | Completada para preparación |
| S02I01-T03 | Implementar extracción directa y contrato/factory. FR01/02/03 | Solicitud explícita de implementación, revalidar huella google.ts | Fachada conserva OAuth/cuota/hook y directo fijo; ningún llamador modificado. | Nuevas pruebas AC01/02/04/05, typecheck del delta. | Completada localmente |
| S02I01-T04 | Implementar adaptador Composio y errores redactados. FR02/04/05/06/07 | T03 | Request/envelope cerrados, un intento, sin selección real, import sin efectos. | Nuevas pruebas AC03/06/07/08/09. | Completada localmente |
| S02I01-T05 | Revisar composición, alcance y evidencia local. FR01–08 | T03/04 | AC01–10 demostrados, no cambios ajenos ni credenciales/APIs; limitaciones explícitas. | Fixtures dirigidos, análisis de imports, TS y diff; ampliar pruebas solo ante riesgo nuevo concreto. | Completada:33/33, TS/formato y preservación correctos |
| S02I01-T06 | Entregar paquete local revisable. FR08 | T05 | Diff/huellas y resultado de QA listos; directo sigue activo, ninguna migración o corte real. | Registro de evidencia y revisión humana del incremento. | Paquete local registrado; sin commit o publicación |

## Orden que desbloquea el producto

| Bloque | Entregable | Condición para avanzar |
|---|---|---|
| S02-I01 | Frontera compatible y adaptador, local | Puede implementarse sin fusionar S01: no habilita Composio ni cambia permisos. |
| Integración coordinada S01 | Paquete I01/I02 más contratos de marca/mapeo/snapshots aún pendientes | Revisar contra001–047, completar T00-02-I y T01-02, numerar delta final con propietario único. No copiar SQL de sandbox como migración. |
| S02 siguiente (T02-02) | Binding estable por cuenta y gestión de conexión/reconexión | S01 integrado; identidad/propietario/config/proyecto revisados; conexión no reactiva envío y cuenta conserva ID. |
| Continuidad (T02-03/04) | Recepción y migración de un buzón con escritor único | Conciliar pendientes/cursor/identidades, aprobar corte y prueba del delta; sin repetir todo el producto. |

T01-03/04 siguen en S01 y no se desarrollan aquí. Instantly C sigue diferida; no bloquea un transporte de correo. La prioridad no autoriza fusionar S01, aplicar SQL, publicar código o cambiar cuentas. Esas acciones se prepararán como paquetes concretos cuando sean necesarias.
