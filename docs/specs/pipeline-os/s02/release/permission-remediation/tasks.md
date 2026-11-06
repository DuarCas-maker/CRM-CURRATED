# Tareas PRM — corrección y revisión acotadas

## Continuidad vigente — resultado de 048

01/11/2026 · El operador reportó ejecutar 048 completo con COMMIT y aportó recibo/postflight. [Comparación y límites](../readiness-review.md), [transcripción técnica y checks](../readiness-report.json): 28/28 objetivos correctos y huella protegida idéntica; estado del catálogo aceptado dentro del scope. PRM-T07 cuenta con resultado del operador revisado, **no ejecución remota del agente ni certificación retrospectiva de backup/ventana/concurrencia/ledger**. No repetir 048 o postflight.

PRM-T08 (defaults/EXECUTE) sigue inventariado. Su efecto en objetos/callers nuevos se trata en REL-T03/07; no revocar globalmente ni reabrir toda la revisión por inferencia. Próximo trabajo: SQL definitivo A/B/C, sin activación o publicación. Las constancias siguientes conservan su estado histórico al prepararse, incluidas las reservas/manifiestos originales.

## Historial

**T06 preparada localmente:** [SQL definitivo 048 y protocolo](final/README.md), 16/16 comprobaciones nuevas y TypeScript correctos. Siguiente: acreditar los controles operativos pendientes y autorización concreta de T07; no ejecutar SQL ahora. No confundir las 39 relaciones bloqueables con las 28 que reciben DCL. Instantly 43/0 nuevas.

**Resultado vigente:** [PRM-T05 completada para la instantánea recibida](vr1-result-review.md): tres vistas aclaradas con comparación exacta y checks locales, sin otra consulta. Siguiente PRM-T06, preparar corrección final/ventana/recuperación. T07 no autorizado; Instantly 43.

**Estado actual:** PRM-T03/04 implementadas/probadas offline, **42/42** y TypeScript correctos. [Evidencia](implementation-verification.md), [runbook](offline-runbook.md). Próximo paso PRM-T05: presentar VR1/hash para autorización separada de una lectura, sin aplicar corrección. T06/07 y promoción permanecen pendientes.

| T / FR               | Entrega                                                                                                               | Estado                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PRM-T01 / FR01/03/04 | Revisar catálogo/consumidores y materializar matrices/inventarios y seis self-dependencies.                           | Preparado/comprobado localmente.                                                          |
| PRM-T02 / FR02/05/06 | Contrato de PRM1, VR1, aceptación, presupuesto y recuperación.                                                        | Preparado; sin SQL/CLI de corrección nuevos.                                              |
| PRM-T03 / FR01–06    | Implementar candidato PRM1 y VR1/validador/fixtures solo locales por instrucción posterior.                           | Implementado offline; sin ordinal final/SQL remoto.                                       |
| PRM-T04 / FR01–06    | QA acotado de privilegios, preservación, atomicidad y tokenizer VR1.                                                  | Comprobado: 42/42 nuevas; datos ficticios, cero red/env.                                  |
| PRM-T05 / FR04/05    | Presentar VR1/hash y obtener/revisar una salida READ ONLY autorizada.                                                 | Completado: una lectura del operador; tres vistas aclaradas.                              |
| PRM-T06 / FR02/05    | Materializar SQL final/ordinal libre coordinado y preparar preflight/frescura/preservación/recuperación/autorización. | Preparado: SQL 048/protocolo/16 pruebas; gates operativos pendientes.                     |
| PRM-T07 / FR02/05    | Aplicar solo corrección aprobada y lectura postflight acotada.                                                        | No autorizado; no deploy, envíos o activación.                                            |
| PRM-T08 / FR03       | Analizar defaults/70 funciones restantes para posible incremento separado.                                            | Inventariado; sin cambios actuales y sin quitar permisos a helpers/worker por suposición. |

Siguiente paso único: acreditar controles operativos del protocolo final antes de solicitar autorización de PRM-T07. Los consumers/callchains sin rol demostrado y la falta de un ledger no se resuelven inventando estado. El cierre de PRM no completa por sí solo los gates de publicación A/B/C.
