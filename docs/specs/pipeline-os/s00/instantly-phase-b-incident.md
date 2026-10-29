# INS-B: detención en comprobación inicial de campaña

28/10/2026, SDD STRICT. Diagnóstico del ensayo real autorizado B25/total36, sin modificaciones de código, nuevos efectos remotos o relajación de validaciones. [Contrato](instantly-phase-b.md), B-FR01/03/06/07/08 y B-AC01/03/06/07/08.

## Síntoma y evidencia

Actualización29/10/2026: [diagnóstico BD completado](instantly-b-diagnostic.md), un GET nuevo y19 acumuladas. Campaña propia pausada; `ai_sdr_id`, `is_evergreen` y `stop_for_company` ausentes, resto de comparaciones coincide. Se demuestra desacuerdo actual con presencia exigida por B, sin probar el campo que falló históricamente. B sigue failed, sin reanudación/escrituras/envíos. El resto del documento conserva evidencia anterior.

El CLI termina con status=failed, B_UNSAFE_CAMPAIGN, stage4. Siete intentos nuevos,18 acumulados: workspace/plan/search/create/initial en N5, emergency_pause/emergency_check en H2, R0. Cada respuesta HTTP terminó OK; la validación semántica posterior a initial rechazó la campaña. Identidad/nombre/workspace habían sido comprobados antes de las guardas, por lo que la pausa se dirigió a la campaña propia. No se llamó a createA/createB/configure/activate/send/verify ni se modificaron campañas ajenas.

Emergency=verified_paused: el POST de emergencia y su GET verificaron identidad/workspace/estado pausado. Esta prueba no acredita todos los campos que fallaron ni el recorrido completo B. closedNonSending=false indica fase sin completar; no contradice la pausa de emergencia verificada. Leads registrados0, envíos del ejecutor0 y operaciones pagas0; facturación global del proveedor no medida.

Fuentes privadas: journal v3 en el mismo archivo operativo, resultado sanitizado y reporte de revisión. Snapshot v2/11, incluido predecessor v1 failed4, reconstruye exactamente los bytes/huella históricos; constancia de scopes intacta. Replay offline HTTP0/envReads0/save0, journal idéntico y cero locks/tmp. No se publicó ID/correo/cuerpo o respuesta completa.

## Causa todavía no demostrada

assertCampaign agrupa bajo B_UNSAFE_CAMPAIGN varios motivos, y el ejecutor no conserva la respuesta ni un código por campo. El journal demuestra dónde falló, pero no permite determinar cuál comparación fue distinta. No se inventa un motivo a partir de los defaults del mock.

| Hipótesis                                                                                     | Evidencia actual                                                                       | Comprobación necesaria                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| El proveedor omitió un campo opcional o devolvió null en vez de array vacío/boolean esperado. | Las guardas exigen presencia explícita; no se capturó forma real.                      | Proyección de presencia/tipo/tamaño de campos de seguridad.                       |
| Normalizó schedule o sequences y la comparación semántica detectó diferencias.                | Se compara el objeto solicitado completo; ninguna respuesta relevante está persistida. | Igualdad por subcampo sin exponer cuerpo/fechas privadas adicionales.             |
| Respondió con estado, bandera o configuración diferente de la solicitada.                     | También produce el mismo error; initial no guarda valores.                             | Revisar exclusivamente estado/campos permitidos de la campaña propia, ya pausada. |

No hay hipótesis confirmada o descartada por falta de respuesta. Sin arreglo de código, normalizaciones, defaults nuevos o retry para ocultar la diferencia.

## Propuesta inicial del diagnóstico

Preparar una extensión de lectura acotada del protocolo terminal: preservar18 y el snapshot v3 fallido, consultar únicamente la campaña propia identificada en ese historial y registrar una proyección sanitizada con motivos por campo. Rechazar cambio de identidad/workspace/manifiesto y cualquier ruta de escritura/envío/verificación. Usar el mismo historial de consumo y reservas durables, sin un contador alternativo o reset. Dimensionamiento preliminar:1 GET y como máximo1 retry de lectura ante error transitorio, hasta2 intentos nuevos; requiere diseño/QA offline antes de utilizarse y no amplía el máximo36 vigente.

La regla actual de no reanudar un ledger B terminal se conserva. No gastar los18 intentos restantes mediante scripts alternativos ni borrar/recrear la campaña para intentar otro recorrido. Tras confirmar la causa, proponer el cambio mínimo con regresión y recuperación explícita del mismo recurso; si apareciera una diferencia de negocio/seguridad/costo, aclararla antes de cambiar el contrato. B-T04, INS-T05-B y S00 no aceptados/completados.

## Implementación posterior autorizada solo offline

Usuario solicitó preparar/implementar y probar sin red, conservando18 y sin reiniciar B. [Contrato/ADR/AC y evidencia BD](instantly-b-diagnostic.md) completados: lectura propia, proyección sanitizada, futura extensión v4 del mismo historial, cap2/20 y bloqueo de mutaciones/replays.28 tests BD y284/284 S00, TypeScript correcto. Los8 archivos operativos siguen idénticos y el ledger real continúa v3 failed18, sin credenciales/API/migración. El diagnóstico real aún no se ejecutó y la causa del rechazo original permanece sin demostrar. No interpretar una fixture con cc_list omitido como respuesta real del proveedor.
