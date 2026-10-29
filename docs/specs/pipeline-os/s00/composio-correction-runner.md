# Ejecutor S00-C: M1 correcto, implementación offline

26 de octubre de2026. Nivel STRICT. C-T02/C-T03 implementados y verificados sin red; ejecución C-T04/C-T05 posterior autorizada y completada: **M1 original recuperado,11 nuevas/92 acumuladas, M2 e histórico correctos, binding pausado y closureComplete=true**. Las secciones offline siguientes conservan el procedimiento y sus antecedentes; no autorizan repetirlo. [Contrato/FR/AC/rollout](composio-m1-correction.md), [evidencia](../verification.md).

## Resultado y archivos

- [s00-composio-correction.ts](../../../../scripts/pipeline-os/s00-composio-correction.ts): validación del snapshot81, dirección esperada, schema v2, fases, límites y verificación de identidad/histórico.
- [s00-composio-reconnect-files.ts](../../../../scripts/pipeline-os/s00-composio-reconnect-files.ts): mismo journal autoritativo, lector v1/v2, atomicidad y bloqueo de downgrade/counters/URLs históricos.
- [s00-composio-reconnect-cli.ts](../../../../scripts/pipeline-os/s00-composio-reconnect-cli.ts): status compatible, precheck offline y acciones correct_* opt-in. Las acciones B se bloquean antes de cargar fuentes cuando ya existe v2.
- [s00-composio-reconnect.ts](../../../../scripts/pipeline-os/s00-composio-reconnect.ts): exporta la validación de fuentes existente; comportamiento B preservado.
- [Tests C](../../../../tests/pipeline-os-s00-composio-correction.test.ts):27 escenarios, con variantes negativas por escenario. [Fixture compartido](../../../../tests/fixtures/pipeline-os-composio.ts) extraído de la suite B, sin efectos al importar; la suite B conserva sus51 casos.

Sin dependencias o cambios de aplicación/Next/worker/DB. Composio HTTP, parsing metadata y locks originales se reutilizan. Las acciones nuevas no contienen rutas de envío, revoke, PATCH, DELETE o refresh.

## Identificar M1 sin red

Se preparó un archivo vacío/privado `.local/pipeline-os/s00-m1-target-email.txt`, sin sobrescribir uno preexistente. El operador debe escribir una única dirección: el remitente del hilo de prueba cuyo asunto termina en -M1. No es el destinatario de prueba ni la cuenta que el navegador elija por defecto. No pegar correo o claves en el chat. No se necesitan cambios de API key o Auth Config para completar este archivo.

El precheck lee como máximo512 bytes, valida dirección, compara huella con M1/M2 originales y solo devuelve un booleano o error sanitizado. Un archivo vacío falla validación. En el ensayo real posterior el operador lo completó, se comprobó coincidencia M1 y se usó esa referencia para OAuth. Ningún correo real se cargó durante QA offline.

Comandos desde la raíz, sin env-file ni --execute:

```powershell
# Estado: solo lee el journal, sin crear directorios, locks o cambiar su versión.
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx scripts/pipeline-os/s00-composio-reconnect-cli.ts

# Solo después de escribir la dirección esperada en el archivo privado.
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx scripts/pipeline-os/s00-composio-reconnect-cli.ts --action=correct_precheck
```

correct_precheck es una acción local explícita: lee fuentes/archivo esperado, no requiere credenciales, no escribe el journal y no usa API. M1_TARGET_IS_M2 / M1_TARGET_NOT_ORIGINAL / INVALID_M1_TARGET bloquean antes de cualquier HTTP. Status por defecto no lee el archivo esperado ni las fuentes/credenciales.

## Fases implementadas y utilizadas en el ensayo autorizado

| Acción            | Efecto                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| correct_prepare   | Exige aprobación C97, gates, fuente81 y target M1. Migra atómicamente el mismo journal a v2, conserva predecessor v1/hash, consulta uso/config/M1/M2 y crea un único enlace. Guarda/entrega URL privada en s00-composio-m1-correction-enlace.txt y queda await_auth. |
| correct_deliver   | Repite solo la entrega local del mismo enlace si falló; TTL útil≥3min, sin HTTP o renovación. Si ya fue entregado no reescribe estado.                                                                                                                               |
| correct_verify    | Exige confirmación humana OAuth. Hasta tres status, luego perfil M1 válido, histórico/relectura, M2 y uso finales. Solo después binding pausado; no edita env o activa campañas.                                                                                     |
| correct_reconcile | Solo si la creación del enlace quedó incierta: una lectura filtrada de alias dentro de R, nunca otro POST. Página ambigua/incompleta o URL perdida deja recuperación pendiente.                                                                                      |
| status            | Offline v1/v2, reporte sanitizado. Un resultado completed se relee sin HTTP/escrituras.                                                                                                                                                                              |

La ejecución requiere --execute, authorized-total97, authorize-m1-correction, authorize-connection-management, included-calls-confirmed y gates-confirmed; verify requiere oauth-completed. Son atestaciones explícitas, no una forma de otorgarse permiso. La implementación se entregó offline; después el usuario autorizó el ensayo real16/97, completado en11/92. No se proporciona aquí un comando para repetirlo ni se infiere otra autorización de estos flags.

El agente avisará para seleccionar Google después del preflight y la entrega válida. No hay navegador automático, polling durante login, prompt/login_hint añadido al REST o captura de contraseña. El usuario abrirá el enlace en ventana separada/incógnito y elegirá la dirección M1 que pasó precheck. ACTIVE solo no acredita identidad. Un perfil válido M2/otro o incompleto detiene la prueba; no hay segundo enlace C.

## Continuidad y recuperación

Schema v2 conserva predecessor21/base60=81 (N15/R2/H4) y sus dos enlaces sin alterarlos. C suma N≤13/R≤3, total≤16; reporte81+C.calls, techo97. El snapshot se valida contra fuente y huella, sin aceptar81 arbitrario, key rotada o otro target. No se borra/reinicia ningún ledger o reserva. Durante QA solo se migraron fixtures; tras autorización real el mismo archivo pasó a v2 y terminó completed con11 llamadas C/92 acumuladas.

Persistencia wx/fsync/rename, límite64KiB, locks run→observation→reconnect. El store impide downgrade, reescritura del predecessor/traces/resultados confirmados, disminución de counters/statusChecks, cambio de URL/TTL ya guardados o volver atrás desde completed. Temporales/locks ajenos nunca se borran para recuperar presupuesto.

POST reservado antes de HTTP, sin retry ante timeout o respuesta perdida. Read retries acotados: máximo uno por operación y tres globales, backoff≥5s y Retry-After; esperas>60s detienen. Interrupción después de una lectura sin persistir proof puede usar R una vez para recuperarlo. Errores permanentes, identidad o metadata inválida no se reintentan al repetir verify/prepare. IN_FLIGHT de link se vuelve uncertain y exige reconcile explícito.

Todos los mensajes baseline y respuesta S00-A deben seguir presentes; se permiten mensajes nuevos válidos y se exige que la relectura conserve el conjunto final. Sin cuerpos/PDF. M2 final incorrecto bloquea binding. Uso final fallido produce bindingVerified=true/closureComplete=false, sin otra petición automática. El CLI devuelve error de proceso si queda recovery_required o cierre incompleto; el reporte distingue la causa.

## QA y límites de evidencia

Siete suites S00: **173/173**,27 nuevos C, cero fallos/skips/cancelaciones; fetch global sustituido por REAL_NETWORK_FORBIDDEN. Proveedor/reloj/store inyectados, direcciones/credenciales/URLs sintéticas; pruebas de disco solo en directorios propios temporales bajo.local. Se comprueban11/13/16 peticiones y totales92/94/97, incluso fallo de uso en la última sin17ª/98ª petición. TypeScript noEmit correcto.

Lectura real del status bajo guard de red y entorno hijo sin credenciales: total81, recovery_required, journals run/observation/reconnect iguales antes/después por SHA-256. No se cargó s00.env/.env.local, no se migró el journal real y no se creó enlace real. Se creó únicamente la plantilla de dirección esperada, vacía. Sin build/typegen porque cargarían.env.local, ni lint por ausencia de script. Suite completa de aplicación no ejecutada; evidencia limitada a S00.

Rollback antes de uso real: retirar la extensión nueva y conservar v1/archivos históricos. Tras migrar a v2, no hacer downgrade que trunque corrección/traces; preservar lector y registro para revisión. Durante la entrega offline seguían pendientes la recuperación real y su autorización97; se completaron después como se registra a continuación. Las métricas/costos globales e integración CRM no quedan acreditados por ese cierre.

## Cierre posterior del ensayo real

Usuario autorizó16 nuevas/97 acumuladas y completó Google con M1. Preflight5 +verificación6 =**11 nuevas/92 acumuladas**, sin retries, mensajes o descargas; perfil M1/histórico/relectura/M2 correctos y uso Instant0 antes/después. Binding M1 aceptado/pausado y closureComplete=true. Replay offline con fetch/save prohibidos dio0 HTTP/0 escrituras, hashes históricos válidos y locks liberados. No se edita env: futuras operaciones deben usar el ID del binding privado v2, no el transporte original revocado. S00 general, automatización CRM y auditoría global de facturación siguen fuera de este cierre. [Resultado verificable](../verification.md).
