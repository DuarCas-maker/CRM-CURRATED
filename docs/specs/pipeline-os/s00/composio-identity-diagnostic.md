# Diagnóstico de identidad después del consentimiento M1

26 de octubre de2026. SDD STRICT, corrección/diagnóstico dentro de S00-B. El operador confirma haber seleccionado la cuenta que entiende como M1. Offline se verificaron fuente histórica intacta, aliases ordenados1/2, perfiles originales diferentes y ausencia de binding. No se atribuye aún el fallo real a cuenta incorrecta.

## Problema y evidencia

profile comparaba hash(str(emailAddress)) sin validar el campo. Fixture con JSON no vacío y emailAddress ausente/malformado reproduce PROFILE_IDENTITY_MISMATCH, indistinguible de otro Gmail. Un payload vacío ya produce INVALID_RESPONSE. Esto demuestra ambigüedad de clasificación local; no demuestra que la respuesta real fuese inválida. No se guardó esa respuesta, por privacidad. Hipótesis abiertas: perfil de otro Gmail, respuesta de perfil incompleta/incompatible o discrepancia en la referencia del operador. Intercambio local de aliases/fuente descartado con lectura offline.

## Alcance y aceptación

- D-FR01 / D-AC01: validar dirección antes de comparar; perfil incompleto produce INVALID_GMAIL_PROFILE, otro Gmail válido conserva PROFILE_IDENTITY_MISMATCH. Ambos bloquean binding. Prueba sintética que falla antes y pasa después.
- D-FR02 / D-AC02: preparar inspect_identity opt-in, una sola lectura proxy GET profile del candidato actual. Devuelve únicamente M1, M2, OTHER o INVALID; no guarda dirección, cuerpo, huellas nuevas o tokens. Sin histórico, PDFs, enlaces, revoke, binding, reactivación o env.
- D-FR03 / D-AC03: solo tras autorización explícita de esta excepción diagnóstica. Preserva N≤21/R≤3/H≤4 y total28/88. La petición se registra en normal como identity_diagnostic, distinguida de reintentar recuperación. No repone H4 ni habilita otro enlace. Base actual20/80; máximo resultado21/81, sin retries automáticos, con reserva antes de HTTP. Una traza previa, incluso incierta, impide repetición.
- D-FR04 / D-AC04: estado recovery_required y checks de recuperación no avanzan con el diagnóstico, incluso si resulta M1. Si se necesita completar recuperación, primero replanificar contrato y obtener aprobación pertinente. El diagnóstico no es recuperación ni cierre S00.

## Diseño y tareas

Reutilizar transporte exacto, fuente y lock/journal existentes; nuevo op/acción y resultado opcional estricto compatible con ledgers anteriores. Gate adicional identityDiagnosticAuthorized / CLI authorize-identity-diagnostic. Exigir fallo de perfil, candidato ACTIVE y fase recovery_required; no permitir prepare o un destino nuevo. request reserva contador/traza antes de HTTP y prohíbe retry para este op. Un crash conserva la traza y exige revisión, no reset. Validar resultado persistido contra única traza OK y bucket normal. No crear otro ledger ni dependencias.

D-T01: reproducir ambigüedad y validar perfil (FR01). D-T02: preparar acción y gate (FR02–04), fixtures de M1/M2/OTHER/INVALID, error de red, repetición, gating y estado inmutable. D-T03: ejecutar suites S00/typecheck/formato; no llamadas reales. D-T04: consulta real de una petición pendiente de autorización específica de esta excepción H4. El techo global88 no aumenta. Reversión de código: retirar acción opcional preservando registros que la contengan; no borrar traces para reutilizar presupuesto. No hay mutación remota que revertir por el diagnóstico.

## Resultado operativo

D-T01–04 completados:146/146 pruebas offline y TypeScript correctos; autorización explícita recibida para una lectura. inspect_identity devolvió **M2**, con dirección válida y comparación contra referencia original, sin exponerla.21 nuevas/81 acumuladas, N15/R2/H4; exactamente una traza OK. Recovery_required y binding sin aceptar se conservan. No se modificó ninguna conexión ni se emitió otro enlace; no se reintentará esta consulta. La recuperación de M1 continúa pendiente y queda fuera de la excepción de diagnóstico. [Evidencia](../verification.md).
