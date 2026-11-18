# Verificación — registro histórico de preparación

Cierre actual de preparación de publicación: [preflight/closure.md](preflight/closure.md), sobre `544b835`, con adjuntos resuelto y cupo global de proxy todavía sin acreditar. Los gates siguientes son históricos.

Estado vigente de promoción: [preflight/release-plan.md](preflight/release-plan.md). Este documento conserva los gates anteriores a la implementación; no sustituye la evidencia de preflight del 18/11 UTC.

Este registro conserva la preparación anterior a la autorización de implementar. El resultado actual está en [implementation-verification.md](implementation-verification.md); no usar los gates pendientes de este registro como estado de la implementación actual.

Fecha 2026-11-17. No se ha implementado este cambio ni ejecutado sus pruebas de producto. No hay despliegue nuevo ni cambios remotos en esta preparación.

| Gate | Evidencia / estado                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0   | Instrucciones, manifests, fuentes OAuth/transporte/worker/UI y base main `9d28d5a` inspeccionados. WIP anterior preservado. `discovery.json` fija las fuentes.                             |
| G1   | Respuestas 1–12 registradas en spec; FR-001–011 y AC-001–011, sin dudas de negocio abiertas.                                                                                               |
| G2   | Diseño/ADR de fachada automática y respaldo antes de emisión. Conciliación exacta del catálogo, configuración OAuth y cupo real pendientes; no se presenta como diseño SQL final aprobado. |
| G3   | T-001–012 trazadas. Manifest propuesto identifica compartidos y nuevos módulos.                                                                                                            |
| G4   | Pendiente: no se editaron archivos de producto ni SQL de implementación.                                                                                                                   |
| G5   | Pendiente: ninguna prueba local/native/UI del nuevo flujo ejecutada todavía. Solo comprobación documental y de referencias, ver `document-check.json`.                                     |
| G6   | Pendiente para este conjunto: release concreto, backup y verificaciones. Publicaciones anteriores no son evidencia de esta entrega.                                                        |

Comando ejecutado: Node 22.23.4 `verify-plan.mjs`, desde este checkout. Resultado: 65 comprobaciones documentales correctas, 0 fallidas, 23 fuentes públicas del commit fijado comprobadas y hasheadas. Una primera ejecución detectó una coincidencia textual demasiado estricta del checker ("uso global" frente a "consumo global"); se corrigió el checker y se repitió satisfactoriamente. Son comprobaciones de preparación, no 65 pruebas de la aplicación. Los archivos de producto y el WIP anterior no se modificaron.

## Hallazgos que condicionan implementación

1. Composio de producto sigue cerrado por constante en runtime-context; no basta añadir un botón.
2. Setup Composio requiere account.ready y no finaliza automáticamente un buzón nuevo disconnected.
3. invalid_grant directo altera estado global y pausa outbox; con dos proveedores exige separar salud y preservar las pausas legítimas.
4. Un dispatch solo admite una operación send; fallback recursivo violaría ese contrato. Se necesita coordinación durable padre/hijo, no resetear el guard.
5. main avanzó desde el release anterior y hay cambios ajenos de campañas. El checkout F2 original no es base de publicación.
6. No se leyó ninguna credencial, configuración real de Google/Composio o dato de clientes. No se confirmó el saldo real por documentación de precios.

## Pruebas que deben ejecutarse

Unitarias de selección de responsable/estado y clasificador de elegibilidad; HTTP de Origin/MFA/sesión/IDOR; DB/RLS/ACL y capacidades; rollback y upgrade reales en clúster local; concurrencia/cancelación/claim y reserva gratuita; captura de número de POST por outbox bajo crash/uncertain; regreso de OAuth duplicado; sincronización 30 días y dedupe; regresión de campañas/hilos/adjuntos/correo directo; UI a tres tamaños y teclado; typecheck/build. Las pruebas de proveedor y SMTP/entrega requieren ejecución real separada y evidencia, nunca se suplen con fixtures.
