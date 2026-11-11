# Tareas QGR — incremento local propuesto

10/11/2026 · STRICT. [Spec](spec.md), [diseño](design.md). Preparar estos documentos no autoriza implementar ninguno de los incrementos siguientes.

| Tarea         | Entrega                                                                              | FR / AC                                          | Depende de                                                          | Estado                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| QGR-T01 / I01 | Contrato puro de política v2 y resolución conservadora de scope; dos archivos nuevos | FR01/02/03/07; AC01–07,14, solo su parte pura    | autorización local recibida                                         | done                                                                                                     |
| QGR-T02 / I02 | SQL local de política/reservas y compatibilidad v1/v2; tests PG15/carreras/reversa   | FR02/03/06/07; AC03–07,12–15, partes SQL         | I01; fuentes protegidas actuales conciliadas, sin modificar Connect | done:26 escenarios PG15,21 I01,TS; i02-verification.md                                                   |
| QGR-T03 / I03 | Integrar admisión común en callers Gmail y adaptador C2 v2 de conexión existente     | FR03/04/05/06/09; AC05–13,18/19, partes servidor | I02, fuente documentada de grants efectivos                         | implementado/probado offline con tokeninfo; compatibilidad real pendiente; i03-tokeninfo-verification.md |
| QGR-T04 / I04 | Asociación v2 y puente de lectores runtime; Connect nuevo en subbloque B posterior   | FR01/04/07/08/10; AC01/02,08/09,14–17,20         | I03; conciliación F2 antes de editar Connect                        | A/R implementado/probado offline; i04-implementation.md; B diferido                                      |
| QGR-T05 / I05 | QA del delta, build web/worker y paquete de migración versionado con rollback        | FR01–10; AC01–20                                 | I04 y evidencia nativa/visual                                       | pending                                                                                                  |
| QGR-T06       | Protocolo real de asociación de un buzón, cupo y presupuesto definitivo              | FR04/05/09; AC08–11,18/19                        | I05, cupo revisado, autorización de publicación y luego ejecución   | pending                                                                                                  |

## Primer alcance concreto: I01

Plan histórico I04: [plan](i04-plan.md), [impacto y huellas](i04-manifest.json),
[verificación documental](i04-verification.md). A1–A4 y R1–R2 priorizan el buzón ya
existente y constituyen un paquete de implementación; I04-B de alta nueva permanece
pendiente y no bloquea su piloto. A/R fue autorizado e implementado localmente después; ver i04-implementation.md. No se autorizan llamadas, migraciones remotas ni activación.

- Alcance original de creación: `src/lib/mail-quota-policy.ts` y `tests/pipeline-os-s02-quota-policy.test.ts`. Ambos se crearon por autorización posterior de I01; [evidencia](i01-verification.md),21/21 pruebas, TypeScript/formato/preservación correctos. No hay integración con producto.
- Schema discriminado/policy_id/generation/límites/estado/metadato Google opcional, resolución estable del grupo común y reglas de compatibilidad. Funciones puras con datos ficticios; ningún valor por defecto convierte ausencia en enabled o evidencia revisada.
- Tests significativos: falta de Google admitida en v2, entradas malformadas/campos extra rechazados, todos los proveedores y Auth Configs convergen al mismo grupo, cambio de generación no altera scope, límites no finitos/negativos rechazados y v1 no reinterpretado como v2.
- No cambiar contexto/verificador/contrato actual, importar el módulo en producto, acceder a env o archivos privados, arrancar worker/servidores, instalar dependencias o aplicar SQL. No es un motor de reserva ni demuestra concurrencia DB.
- Done de I01 alcanzado: pruebas nuevas y TypeScript correctos, diff limitado y fuentes protegidas intactas; comportamiento sin integrar explicado. No completa las partes DB/HTTP de los AC citados. La autorización de I01 no se extiende a I02.

## Definición de cierre posterior

I02 requiere que una transacción comparta locks/consumo entre dos conexiones reales de fixture y preserve el histórico al habilitar; comprobar orden de locks, replay y límites diarios, con rollback tanto vacío como con datos. Ningún contador se reinicia para hacer pasar pruebas.

Alcance concreto autorizado de I02: [diseño](i02-design.md), dos SQL locales sin ordinal y un test nativo nuevo. No se integran callers ni se editan fuentes de F2. Su snapshot final y contratos efectivos siguen siendo gate de I03/I04. El permiso adicional permite solo reutilizar binarios PG15.19 de F2 en un clúster propio loopback; no sus datos, env o contadores. Los SQL nuevos están bloqueados fuera de fixtures `qgr_i02_*`.

I03 exige inventario exhaustivo de entradas: google.ts, runtime, C2 y perfil de onboarding, además de worker y web que reutilizan la fachada. Pruebas de deadline y revalidación después de espera; envío incierto no se repite. No se puede marcar terminado si algún caller bypass queda sin cuota o si solo hay un mock de permisos sin contrato externo acreditado.

Registro histórico previo a TI: admisión Gmail/runtime/perfil y RPC de emisión única implementados; transporte
bajo nivel protegido; C2 v1 bloqueado con v2 activo; verificador v2 normalizado y
adaptador de metadatos existentes probados. La fuente de grants efectivos sigue sin
acreditar y el adaptador wire devuelve null/permission_unproven. QGR-T03 **no está done**.
I04 incluye comandos/DTOs/persistencia/UI v2 y scope previo a materializar altas nuevas,
con conciliación F2. Ninguna guarda se elimina para aprobar con scopes declarados.

Actualización TI: CR-TI01 sustituye el puerto null por POST tokeninfo mediante proxy
fijo, plazo efectivo y evidencia mínima. TI-T01–04 terminan con contrato y pruebas
offline; los checks reales de compatibilidad, cupo y recepción de grants del buzón
no se declaran terminados mediante mocks. QGR-T03 no se marca cerrado operativamente.
I04 puede usar el contrato local concreto conservando ese gate real antes de aceptación
externa; ninguna ruta o aprobación existente queda habilitada por este incremento.

I04 debe partir de F2 final, no de sus fuentes parciales. Versionar DTOs/recibos en lugar de modificar los manifests sellados. I05 no repite pilotos históricos aceptados; prueba solo el delta y regresiones pertinentes. La preparación del SQL final no autoriza aplicarlo ni reservar un ordinal que otro frente pueda usar.

Paralelismo: F2 puede continuar con su delta compatible actual; I01 futuro no toca sus archivos. No se permite que dos chats editen C1/Connect/rutas/SQL al mismo tiempo. Coordinación posterior por manifiesto/huellas; hoy no se envían mensajes a otros chats.
