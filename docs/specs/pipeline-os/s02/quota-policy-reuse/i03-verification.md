# I03 — evidencia offline y gate pendiente

Actualización posterior10/11: [tokeninfo](i03-tokeninfo.md) y su
[verificación](i03-tokeninfo-verification.md) sustituyen el puerto real null por una
fuente concreta basada en contratos públicos. La evidencia de74 escenarios siguiente
se conserva como histórica. No se ejecutaron nuevas pruebas reales; el endpoint
Composio→Google todavía no está demostrado para la conexión del operador.

10/11/2026 · STRICT · HEAD00b00937b8de7eea1966a6b2c3189bf1c9db8023.
Implementación local autorizada. [Diseño](i03-design.md), [tareas](tasks.md).

## Estado exacto

Admisión común integrada y verificador v2 implementado/probado offline. **QGR-T03 no
está done**: falta acreditar el contrato de una fuente de permisos efectivos. El
adaptador real de metadatos devuelve `permission_unproven` y no consulta perfil ni
aprueba una asociación por ver scopes declarados. Los casos positivos usan un puerto
normalizado sintético; no son evidencia de permisos de la conexión real.

No hay una nueva ruta/UI de comprobación o confirmación v2; su conexión con comandos,
DTOs y persistencia se mantiene en I04. Los bindings v2 siguen sin poder quedar
verified mediante las guardas de I02. No se activa proveedor ni se cambia escritor.

## Archivos y comportamiento

| Superficie                                                         | Cambio                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/mail-quota.ts` nuevo                               | Política/snapshot, reserva, espera, revalidación y lease de una emisión; contexto inyectable, errores saneados y prueba efímera para transportes.                                                           |
| `src/lib/server/google.ts`                                         | Las ramas directa y runtime usan la misma reserva; costo del método actual, clave/deadline del intento cuando existen, sin debitar también039 en v2.                                                        |
| `src/lib/server/mail-transport/runtime-context.ts`                 | Pasa ticket real a cuota, conserva capacidades/confirmación de entrega y revalida antes de wire.                                                                                                            |
| `gmail-direct.ts`, `composio-proxy.ts` en la carpeta anterior      | No permiten saltarse admisión v2 por acceso al transporte bajo nivel; prueba limitada a provider/path/method, de uso único, con deadline final.                                                             |
| `src/lib/server/mail-accounts/composio-connect/http.ts`            | Reserva el GET perfil del host, con sesión/intent/config/deadline frescos; metadatos y links conservan presupuesto separado de Gmail.                                                                       |
| `src/lib/server/mail-accounts/composio-verifier.ts`                | V1 intacto con v2 apagado; v1 bloqueado antes de proveedores cuando v2 está activo para impedir un bypass.                                                                                                  |
| `src/lib/server/mail-accounts/composio-existing-verifier.ts` nuevo | Contrato v2 sin Google obligatorio; política/digest versionados, tuple exacta, owner original, permisos con procedencia y caducidad, perfil bajo cuota.                                                     |
| `src/lib/server/mail-accounts/composio-existing-provider.ts` nuevo | Dos GET documentados y perfil proxy fijo protegido por lease; lectura acotada, sin extraer credenciales, inferir grants o generar OAuth. El flujo normal no llega al perfil sin fuente efectiva acreditada. |
| `.env.example`                                                     | `MAIL_QUOTA_POLICY_ENABLED=false`; ninguna variable real modificada.                                                                                                                                        |
| `migrations/quota-i03.local.sql` en esta carpeta                   | Snapshot service-only y admisión única con not-before/deadline, vigencia de política y cuenta connected.                                                                                                    |
| `migrations/quota-i03.rollback.sql`                                | Cierra, retira los RPC nuevos y conserva recibos/admitted_at/historial.                                                                                                                                     |
| `tests/fixtures/pipeline-os-quota-i03.ts` +5 tests nuevos          | Cuota, verificador, fachada real con mocks, host Connect con SQL ficticio y PG15 nativo.                                                                                                                    |

No se editan UI/rutas HTTP, worker, config/provider/store de F2, SQL039/049/050/051,
package/lock, fuentes I01/I02 o archivos privados. Las siete fuentes compartidas
modificadas tienen huella anterior en `i03-baseline.json` y posterior en manifest.

## Compatibilidad y alcance de la activación futura

Con flag ausente/false no se consulta el esquema nuevo y Gmail directo conserva la
reserva039. Con flag true, esquema/snapshot inválidos bloquean; una política disabled
permite solo directo legado. Composio v2 exige política enabled y sigue además
cerrado por `composioProductOperationEnabled=false`. El flag no es autorización de envío.

Para habilitar v2 en el futuro se requieren migración final y transición revisadas,
Gmail con scopes/intentos de servidor vigentes y cobertura de todos los accesos.
El perfil Connect de una cuenta nueva proyecta un UUID reservado antes de tener fila
CRM: I02 lo rechaza como cuenta inexistente. Se prueba ese cierre; resolver ese scope
de alta queda en I04. No se fabrica una cuenta connected para pasar la reserva.

La implementación añade reservas y admisiones internas a Supabase cuando se habilite;
no son llamadas Composio ni Instantly. Sus límites no certifican saldo/costo externo.
La reserva no se reembolsa si después se cancela: sobrecuenta de forma conservadora.

## Pruebas ejecutadas

Node22.23.4, dependencias existentes; sin cargar env. Fake fetch/SDK/DB explícitos y
sin invocar red real de negocio. Suites relevantes a los compartidos modificados:

| Comando después del Node local                                                                                                                                                                                                                                                                                     | Resultado observado                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `node_modules/tsx/dist/cli.mjs --test tests/pipeline-os-s02-quota-integration.test.ts tests/pipeline-os-s02-existing-verification.test.ts tests/pipeline-os-s02-quota-facade.test.ts tests/pipeline-os-s02-quota-connect.test.ts tests/pipeline-os-s02-block-c-verifier.test.ts` (con soporte de mocks de módulos) | 76/76 nodos reportados,0 fallos/omitidas; incluye28 de C2 legado y el launcher aislado de fachada |
| Subproceso fachada con `--experimental-test-module-mocks --import tsx --test tests/pipeline-os-s02-quota-facade.test.ts`                                                                                                                                                                                           | 7 escenarios reales de fachada con clientes falsos, más contenedor; sin HTTP real                 |
| `node_modules/tsx/dist/cli.mjs --test tests/pipeline-os-s02-transport-runtime.test.ts tests/worker-pilot-api.test.ts`                                                                                                                                                                                              | correctos dentro de la ejecución de49 nodos junto a C2 y los3 nuevos de Connect                   |
| `node_modules/tsx/dist/cli.mjs --test tests/pipeline-os-s02-transport.test.ts tests/pipeline-os-s02-connect-http.test.ts tests/gmail-recovery.test.ts`                                                                                                                                                             | 44/44 nodos,0 fallos/omitidas                                                                     |
| `node_modules/typescript/bin/tsc --noEmit --incremental false`                                                                                                                                                                                                                                                     | exit0                                                                                             |

Tras completar el wire de perfil y sus negativos se ejecutó nuevamente solo el archivo
`pipeline-os-s02-existing-verification.test.ts`: **31/31**,0 fallos/omitidas. La fachada
se observó también directamente en subproceso:8/8 nodos incluyendo sus7 escenarios.
Desglose de escenarios nuevos únicos (sin sumar reejecuciones o contenedores):
22 de admisión,31 de verificación/wire,7 de fachada,3 Connect y11 PG15 = **74**.
Los positivos del wire siguen usando fetch/grants sintéticos; no acreditan la conexión real.

Los reintentos de comprobación tras cambios no se suman como nuevos escenarios.
Son regresiones offline de las superficies tocadas, no repetición de pilotos reales
aceptados de recepción, adjuntos o importación. No se ejecuta worker ni servidor web.

### PostgreSQL 15 físico

Flag explícito `PIPELINE_OS_QGR_I03_NATIVE=1` y `PIPELINE_OS_QGR_PG_BIN` apuntando solo
a los binarios ya autorizados. Comando:

```powershell
& .local/toolchains/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs --test tests/pipeline-os-s02-quota-admission-db.test.ts
```

**11/11 escenarios nativos**,12/12 nodos incluyendo contenedor,0 fallos/omitidas.
Clúster propio loopback, puerto efímero y datos ficticios en
`.local/pipeline-os/qgr-i03/runs/b237ca14206e/cluster`; detenido al finalizar.
`result.json` local registra el cierre. No se copian o abren datos/env/contadores de F2,
ni se instala PostgreSQL o un servicio del sistema.

Es un fixture enfocado de dependencias mínimas sintéticas más el RPC039 real,
SQL I02 sellado y overlay I03. No se presenta como ensayo del catálogo completo de
la aplicación; esa parte de I02 conserva su evidencia anterior. Casos:

1. Marcador local y fallo final revierte DDL.
2. Snapshot inicial sin operación habilitada, ACL humano/servicio y tabla privada.
3. Política publicada, recibo admitido una vez, replay rechazado.
4. UUID reservado sin cuenta CRM real no obtiene reserva.
5. Recibo sin deadline versionado no admite.
6. Caducidad conserva el consumo y bloquea wire.
7. Cambio de política bloquea recibo pendiente sin resetear consumo.
8. Cuenta desconectada después de reservar no admite.
9. DB impide admitir antes del pacing reservado.
10. Dos conexiones físicas, bloqueo observado en pg_stat_activity: una admite y otra no.
11. Reversa conserva datos/admitted_at y cierra la política.

## Trazabilidad y revisión

| FR / AC, parte cubierta    | Evidencia                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR03 / AC05–07             | Compatibilidad flag off; costos exactos; sin doble reserva; deadline/señal/política/revocación después de pacing y al borde del transporte.                  |
| FR06 / AC12/13/15          | Scope de servidor antes de credenciales, intent/capacidad runtime conservados, emisión única en DB, sin retry/fallback.                                      |
| FR04/05/07 / AC08–11/14/15 | Tuple/owner exactos, digest v2 incluye cuota/credencial/config, no inventar Google ni grants, grants caducados bloquean antes del perfil; v1 no opera v2.    |
| FR09 / AC18/19             | Contratos presupuestarios separados; adapter wire cerrado antes de perfil sin evidencia;0 llamadas reales; no certificar saldo externo por pasar el fixture. |
| FR08 / AC16/17             | WIP previo conservado, delta explícito, ningún otro worktree editado, SQL sellado/I01/I02 intactos.                                                          |

Se aplicó safe-code-review al delta: permisos/ACL, mutación de inputs, tiempo antes
y después de await, replay, fallos parciales y compatibilidad. Se añadieron guardas
y regresiones para grants que vencen durante la espera, cambio de contexto durante
autorización, request mutable, vencimiento en el borde del transporte y recibos sin
deadline. El fallo inicial del test de alta nueva detectó un fixture que trataba el
UUID reservado como cuenta materializada: se corrigió para modelar la FK, y PG15
confirma el rechazo real sin debitar. TypeScript se corrigió sin relajar tipos de producto.

## Contrato externo, riesgos y siguiente paso

Se leyeron solo fuentes oficiales públicas, sin credenciales:
[GET conexión](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid),
[GET Auth Config](https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigsByNanoid),
[scopes](https://docs.composio.dev/docs/authentication/controlling-scopes).
La documentación distingue configuración solicitada de autorizaciones de conexiones
existentes. No se ha acreditado una fuente de grants efectivos para este adapter;
inferir que requested_scopes los prueban sería inseguro. No se afirma que Composio
carezca de esa capacidad en toda interfaz: falta evidencia contractual concreta.

Gmail directo conservado, Composio apagado, Instantly43/0 nuevas. Sin envíos, API de
negocio, SQL remoto, publicación o despliegue. No se repite050. No se consume remanente S00.

Pendientes: fuente efectiva de permisos, comandos/DTOs/persistencia/UI v2 y scope
previo de altas nuevas en I04, conciliación F2, QA del conjunto y migración final
versionada. No se hizo build web/worker ni QA visual: no hay UI nueva y no es release.
Ninguno de los20 AC end-to-end queda completado operativamente por estos mocks.

Reversa local de código: retirar únicamente el delta enumerado en el manifiesto,
conservando WIP/I01/I02; no usar reset/clean sobre el checkout. Reversa del overlay:
usar su SQL local de cierre; no borrar recibos ni deshabilitar el guard durante una
operación en vuelo. No ejecutar estos candidatos en producción.

Siguiente paso concreto: acreditar y especificar la fuente efectiva de permisos para
cerrar el gate I03 antes de conectar la aprobación v2 o habilitar Composio.
