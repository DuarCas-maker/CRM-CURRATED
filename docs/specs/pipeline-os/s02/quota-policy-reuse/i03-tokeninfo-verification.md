# QGR-I03-TI-r1 — evidencia offline

10/11/2026 · STRICT · [contrato/CR-TI01](i03-tokeninfo.md).
Baseline previo: [huellas](i03-tokeninfo-baseline.json), HEAD
00b00937b8de7eea1966a6b2c3189bf1c9db8023. La autorización cubre especificación,
implementación y pruebas offline del adaptador tokeninfo. No cubre llamadas reales,
activación, publicación, SQL remoto, credenciales privadas o aprobación de una cuenta.

## Resultado y límites

TI-T01–04 completadas localmente. El adaptador ya no devuelve null sin consultar:
compone dos lecturas metadata, tokeninfo por proxy y perfil bajo reserva. El positivo
usa el provider/verifier reales con fetch/DB/reloj/autorización ficticios, no un puerto
de grants inventado. Los campos scope/expires_in/aud de Google son el contrato de la
biblioteca oficial; Composio aporta la envoltura status/data y la credencial.

La inferencia de compatibilidad entre ambos contratos está revisada, pero **no se ha
demostrado el wire Composio→tokeninfo para el buzón real**. No afirmar que el producto
está operativo ni que el grant de Daniel quedó acreditado. QGR-T03 conserva el gate
operativo; el contrato local permite continuar I04 con esa separación explícita.
No se implementan rutas/UI, aprobación/persistencia v2, corte de proveedor o histórico.

## Delta de archivos

- `src/lib/server/mail-accounts/composio-existing-provider.ts`: tokeninfo fijo,
  versión de credencial capturada, reloj inyectable, validación acotada, prueba
  mínima y plazo conservador. Guardia de presupuesto/autorización dentro del timeout;
  no-store/omit/manual y ninguna exportación de token, header o claim personal.
- `src/lib/server/mail-accounts/composio-existing-verifier.ts`: pasa deadline y
  autorización fresca al puerto antes del wire; el resto de guards y esquema v2 intactos.
- `tests/pipeline-os-s02-tokeninfo.test.ts`:50 escenarios nuevos; fetch falso rechaza
  origen/ruta/body/headers inesperados y demuestra cuatro HTTP máximos normales.
- `tests/pipeline-os-s02-existing-verification.test.ts`:31 escenarios conservados;
  factories ahora reciben versión de credencial explícita y el caso de scopes declarados
  incorpora rechazo real del puerto tokeninfo simulado, sin fallback al perfil.
- Documentación QGR y budget/manifest: registran CR, trazabilidad, evidencia, límites
  y nueva proyección. No se modifican fuentes I01/I02, SQL, flags o datos privados.

## Checks observados

Node22.23.4 existente; sin instalación, env-file o servidor. Prefijo de todos los
comandos: `.local/toolchains/node-v22.23.4-win-x64/node.exe`.

| Comando / alcance                                                                                                                                                                                                             | Resultado                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `node_modules/tsx/dist/cli.mjs --test --test-reporter=spec tests/pipeline-os-s02-tokeninfo.test.ts tests/pipeline-os-s02-existing-verification.test.ts`                                                                       | 81/81,0 fallos/canceladas/omitidas:50 nuevos +31 existentes                                        |
| `node_modules/tsx/dist/cli.mjs --test --test-reporter=spec` con quota-policy, quota-integration, quota-facade, quota-connect, block-c-verifier, transport-runtime, worker-pilot-api, transport, connect-http y gmail-recovery | 137/137 nodos,0 fallos/canceladas/omitidas; incluye launchers que comprueban subprocesos con mocks |
| `node_modules/typescript/bin/tsc --noEmit --incremental false`                                                                                                                                                                | exit0 después de completar código/tests                                                            |
| Prettier y `git diff --check`                                                                                                                                                                                                 | ver cierre del manifiesto; comprobados sobre el delta                                              |

No sumar subprocesos o reejecuciones como escenarios adicionales. Los74 de I03 previo
permanecen históricos; esta ejecución añade50 escenarios TI, no81 nuevos.

Primera pasada:72/74 y error TS en fixtures. Dos casos intentaban mutar un flag de
dependencias después de que AsyncLocalStorage lo capturase como snapshot inmutable.
Se corrigió el fixture para representar v2 deshabilitado antes de entrar, sin aflojar
guards de producto. Se corrigieron literal2 y entrada extra mediante variable para
probar validación runtime manteniendo tipos estrictos. Después se añadieron ocho
casos de review; resultado final81/81. No se ocultaron ni omitieron fallos.

## Trazabilidad y revisión

| AC      | Evidencia                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TI-AC01 | Recorrido real con4 fetch falsos; extracción mínima sin access_token/email/aud en el resultado; expires_in string; scopes duplicados normalizados.                                                               |
| TI-AC02 | 20 variantes: scopes ausentes/parciales/malformados/excesivos, aud ausente/vacío, caducidad inválida, exp pasado, email ajeno/no verificado y error OAuth. Perfil nunca se consulta.                             |
| TI-AC03 | Actor revocado/inicialmente denegado, credencial rotada, deadline/aborto después del presupuesto; v2 off antes de invocar; presupuesto agotado; target mutable y URL extra no redirigen; key/version capturadas. |
| TI-AC04 | 403/429/500, redirect, HTML/JSON/UTF8 inválidos, tamaño declarado/stream >256KiB, red fallida, status interior403; budget pendiente/stream abortados sin emisión tardía ni retry.                                |
| TI-AC05 | Vida limitada por exp y tiempo anterior a red; tránsito consume vigencia; regresión de reloj/step >10s cancelan; vence durante pacing/perfil y jamás pasa.                                                       |
| TI-AC06 | Regresiones de cuota/directo/Connect/runtime; fuente Composio product-disabled, flags/SQL/otros callers comparados con baseline.                                                                                 |

Revisión safe-code-review.
En la última lectura del OpenAPI público se detectó que los parámetros REST exigen
`type`, mientras la interfaz SDK consultada usaba `in`. Se corrigió la serialización
y la expectativa wire contra ese esquema, y se añadió el caso de intento de inyección
de parámetros/Authorization. La composición completa final usa `type: header`.

Revisión final: no destinos dinámicos, secretos, reintentos cliente,
fallback por scopes declarados o prueba enviando correo. Se añadió no-store/omit
para no reutilizar metadata y no aportar cookies; el tokeninfo no debita unidades
Gmail. No se relajan los plazos generales30s/step10s ni el lease del perfil. El guard
de presupuesto también está dentro de la cancelación; no puede emitir al terminar
tarde. Respuestas y errores se reducen a hechos o códigos; no hay logs de proveedor.

Sin nuevo DDL: no procede otro ensayo PG15 ni migración. Las regresiones que usan
PGlite/DB ficticia son locales; no acceden a Supabase remoto ni arrancan clúster nativo.
Sin UI: no procede build/QA visual de este incremento. Build de release queda en I05.

## Preservación y siguiente paso

Baseline TI:16 fuentes, cambian solo provider/verifier/test existente; las otras13
conservan SHA256. Fuentes I01/I02, SQL local I03, .env.example, fachada y transportes
sin cambio adicional. Manifiesto registra huellas finales de los tres y el test nuevo.
Gmail directo conservado; Composio product-disabled; Instantly43/0 nuevas; API negocio0,
envíos0, SQL remoto0 y publicación0. No se abrió env real ni ledger privado.

Siguiente paso: I04 (comandos, DTO, UI/persistencia v2 y scope previo de alta nueva),
seguido de QA/release; el protocolo real presupuestará4 peticiones normales y hasta
1 de diagnóstico separado, cupo y autorización explícitos. El check real de tokeninfo
sigue pendiente; no reautorizar Google ni activar Composio automáticamente si falla.

Rollback TI: retirar solo los cambios de las tres fuentes según baseline y el test
nuevo, o volver al puerto cerrado; preservar WIP/I01/I02, recibos y contadores. No
usar reset/clean, migrar esquema o desactivar guardas para que una prueba pase.
