# INS-BR: detención tras configurar la campaña — SDD STRICT

29/10/2026. Ejecución real autorizada BR22/41 conservando19, sin costos adicionales/envíos/verificaciones pagas. [Protocolo y AC](instantly-b-recovery.md). Resultado **failed/stage5/B_UNSAFE_CAMPAIGN,8 nuevas/27 acumuladas,N6/R0/H2; emergencia verified_paused**. No repetir el ensayo o gastar remanente por otra ruta. No se modifica código para interpretar una respuesta que no se conservó.

## Evidencia comprobada

Preflight local antes de cargar credenciales: fuente v4 completed19, recovery not_started, bindings válidos y ocho archivos operativos idénticos, sin locks/tmp. Se preserva evidencia de Hyper Growth/API incluida con renovación06/11/2026, sin compras o cambio de plan. La autorización explícita del usuario cierra el gate22/41 y uso interno de s00.env; no se abrió como texto o se cargó .env.local.

Se ejecutó la CLI una sola vez con phase=B_RECOVERY/execute/authorized-new22/authorized-total41/included/reviewed. La traza validada contiene ocho respuestas de transporte OK, sin retry:

| Intento nuevo | Operación                              | Resultado comprobable                                                                        |
| ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1/N           | GET workspace.                         | Identidad validada antes de avanzar.                                                         |
| 2/N           | GET plan.                              | Pasó condición de Outreach y≥2 posiciones disponibles; no se registró el saldo exacto.       |
| 3/N           | GET campaña inicial.                   | Identidad propia/workspace/nombre, pausa y guardas OC iniciales válidas.                     |
| 4/N           | POST leads/list de lectura inicial.    | Audiencia vacía y sin cursor.                                                                |
| 5/N           | PATCH configuración de campaña propia. | Transporte OK, pasó a stage5; la validación semántica posterior no se considera demostrada.  |
| 6/N           | GET campaña configurada.               | Transporte OK; assertCampaign rechaza una guarda con B_UNSAFE_CAMPAIGN antes de crear leads. |
| 7/H           | POST pausa de emergencia propia.       | Transporte OK, sin repetición.                                                               |
| 8/H           | GET de emergencia.                     | Identidad/tenant/estado pausado verificados.                                                 |

El PATCH es un efecto real autorizado sobre la campaña existente; no se afirma que quedó sin modificar. La secuencia solicitada era ficticia, sin remitentes y con flags explícitos, pero su representación remota completa no se validó. No hubo POST de creación de campaña, POST de creación de leads, actualización A/B, activación, envío, verificación paga, compra o cambio de plan. Leads registrados0. La pausa de emergencia confirma seguridad de estado al cierre, no aceptación de toda B o semántica de todos sus campos. closedNonSending=false expresa aceptación incompleta.

## Causa no demostrada y límites del diagnóstico local

assertCampaign comprueba primero ID/nombre/workspace con códigos separados y después agrupa bajo B_UNSAFE_CAMPAIGN: estado/pausa, listas vacías, opcionales compatibles, stop_on_reply=true e igualdad semántica exacta de schedule/sequences. El error agrupa varias condiciones y BR no conserva respuesta/proyección por campo. El journal local prueba el paso y la pausa de emergencia, pero no identifica cuál guarda falló.

| Hipótesis                                                                                        | Evidencia a favor / límite                                                                              | Comprobación pendiente                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sequences normalizadas al guardar: estructura/valores/defaults distintos del payload solicitado. | El fallo aparece tras el primer PATCH; no se conservó forma remota. No se confirma por mocks.           | Comparar por rutas fijas presencia/tipo/igualdad del paso/variante/campos declarados, sin cuerpo de correo. |
| El PATCH omitió, cambió o devolvió con otro tipo un campo de seguridad o schedule.               | OC solo tolera los tres opcionales documentados; las demás guardas siguen estrictas. No se sabe cuál.   | Proyección actual por campo de guardas/configuración contra payload configurado esperado.                   |
| Estado de configured distinto a pausa en esa lectura.                                            | También genera el mismo código; el GET posterior a la emergencia confirma pausa, no el estado anterior. | Lectura actual de identidad/pausa; no prueba retrospectiva de la respuesta perdida.                         |

Descartados en el tramo observado: falta de cupo o audiencia inicial existente (preflight pasó), error de transporte en las ocho peticiones (todas OK), creación de otra campaña/lead o duplicación/reintentos (rutas no llamadas). No se atribuye el fallo a los opcionales concretos corregidos en OC ni se reinterpreta el diagnóstico BD anterior. No hay corrección, defaults nuevos o relajación de guardas en este incremento.

## Integridad, contador y privacidad

Ledger v5 conserva exactamente el snapshot v4 completed19 y sus antecedentes failed18/completed11/failed4. Reconstrucción del formato del snapshot19 coincide con SHA256 de los bytes previos; hash interno de fuente válido. Los otros siete archivos privados de manifiesto/scope/revisión/evidencias/autorización/resultado anteriores permanecen idénticos. Se crea únicamente un reporte sanitizado privado separado `br-real-result.json`; no altera los anteriores.

Replay sobre v5 terminal con env/fetch/save que fallarían ante uso:0/0/0, mismo hash del journal y calls27. Sin locks/tmp o ejecución activa. Catorce intentos del máximo41 quedaron sin usar; no reponen H2 ni autorizan reabrir el terminal, recrear campaña, cambiar datos o ejecutar un diagnóstico no diseñado. Cero envíos/operaciones pagas del ejecutor; providerBillingMeasured=false, sin auditoría independiente de facturación global.

BR-T04 fue ejecutada una vez y **no aceptada**; BR-AC01/02 y condiciones iniciales03 tienen evidencia real parcial, AC04/05 completos pendientes; guardas/emergencia06/07 e integridad/privacidad08 demostradas en el tramo ejecutado. QA316/316/TypeScript permanece evidencia offline previa, no se repite por documentación/ejecución sin cambios de código. Validación local de ledger, lineage, replay y preservación sí ejecutada ahora.

## Próximo incremento propuesto

Preparar un diagnóstico de solo lectura del mismo recurso con fuente exacta v5 failed27/stage5, comparación **configurada** (no inicial), identidad/pausa y proyección sanitizada por campo; preservar B/BD/BR e historia27. Presupuesto preliminar: un GET y un retry transitorio como máximo, hasta2 nuevas/29 acumuladas, dentro del techo histórico41 pero con protocolo/QA/permiso de excepción propios antes de ejecutar. No utilizar el CLI BD anterior, cuya fuente18/payload inicial son incompatibles con este estado.

Rollback actual: no borrar campaña/contactos o degradar el registro. La misma campaña quedó pausada; conservar esa evidencia y los cambios de configuración ya intentados. Corrección posterior depende del diagnóstico, no de ensayos de escritura adicionales. B/C/D y S00 continúan abiertos.
