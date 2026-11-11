# I02 — resultado local de reservas SQL

10/11/2026 · SDD STRICT · implementación autorizada · HEAD `00b00937b8de7eea1966a6b2c3189bf1c9db8023`.

## Resultado

I02 completo dentro de su alcance local. [Diseño previo](i02-design.md),
[tareas](tasks.md), [aceptación general](acceptance.md).

- [quota-policy-v2.local.sql](migrations/quota-policy-v2.local.sql): esquema privado,
  publicación humana MFA/CAS, reserva de servicio, captura del consumo039, límites
  compartidos/cuenta/proyecto, recibos idempotentes y expansión compatible de bindings.
- [quota-policy-v2.rollback.sql](migrations/quota-policy-v2.rollback.sql): cierre que
  conserva datos; eliminación del delta únicamente cuando está vacío.
- `tests/pipeline-os-s02-quota-reservations-db.test.ts`: fixture PG15 nativo nuevo,
  datos ficticios, permisos y carreras físicas. Sin paquete adicional ni cliente HTTP.
- Documentos QGR actualizados; no se modifica código de producto, SQL sellado,
  package/lock, otros worktrees o configuración privada. I01 conserva sus dos fuentes.

El SQL no tiene ordinal y rechaza ejecución fuera del fixture local. No es la
migración que deba pegarse en producción. Ninguna reserva llama a Gmail/Composio,
da permisos de una cuenta o activa transporte. V2 aún no puede quedar `verified`:
la asociación/verificación/runtime versionados corresponden a I03.

## Entorno y comandos ejecutados

Node22.23.4 y dependencias existentes. Por respuesta explícita del operador se usaron
solo binarios portátiles PostgreSQL15.19 de F2: sin copiar toolchain, instalar servicio,
abrir datos/env/contadores del otro checkout ni reutilizar su clúster. Clúster nuevo en
`.local/pipeline-os/qgr-i02/runs/5f2ee62ec305/cluster`, loopback127.0.0.1, puerto efímero,
roles/base propios y `auth.sessions.refreshed_at` naive UTC como el self-hosted observado.
La suite comprueba versión, usuario, dirección y ruta propia antes de materializar DDL.
El clúster se detiene en `finally`; resultado local `result.json`: `clusterStopped=true`.
Inventario posterior: ningún proceso PG/psql/pg_ctl de QGR permaneció activo.

Fixture: 47 migraciones históricas y únicamente bloques DDL/ACL aceptados de049/050
en una base ficticia nueva. No se ejecutaron sus protocolos de aplicación, el SQL
remoto, el worker ni Auth/PostgREST. Cada escenario clona su base inicial: no se
reinician contadores dentro de una transición o carrera para fabricar aceptación.

Comando nativo reproducible desde PowerShell, sin cargar archivos env:

```powershell
$env:PIPELINE_OS_QGR_I02_NATIVE='1'
# Ruta a binarios previamente autorizados; no es una URL ni un directorio de datos.
$env:PIPELINE_OS_QGR_PG_BIN='<ruta autorizada>/pgsql/bin'
& .local/toolchains/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs --test tests/pipeline-os-s02-quota-reservations-db.test.ts tests/pipeline-os-s02-quota-policy.test.ts
```

Resultado final: **26/26 escenarios nativos +21/21 unitarias I01**. Node reporta
48/48 incluyendo el contenedor de la suite nativa;0 fallos,0 canceladas,0 omitidas.
Duración final74,8s. Ejecuciones iniciales sirvieron para ampliar cobertura/revisión;
la cifra anterior corresponde a las fuentes finales, no suma reintentos.

Otros checks:

| Check | Resultado |
| --- | --- |
| `node_modules/typescript/bin/tsc --noEmit --incremental false` con Node local | exit0 |
| Prettier de I01 y nuevo test I02 | correcto |
| Test I02 sin flag nativo |1 omitido intencional;0 servidores iniciados |
| SHA256 baseline |960 tracked y15 untracked previos intactos |
| Fuentes protegidas |20 fuentes +2 de I01 intactas |
| Revisión safe-code-review | contrato, ACL, nulos, continuidad, locks, replay, deadlines y reversa revisados |

## Trazabilidad y pruebas nativas

| FR / partes AC | Evidencia ejecutada |
| --- | --- |
| FR02 / AC03,04 | Grupo constante para dos cuentas y directo/Composio; cuenta compartida; proyecto directo debita una sola vez; espera máxima entre slots, sin sumar demoras duplicadas. |
| FR03 / AC05,06 | RPC039 y catálogo anterior intactos; consumo anterior dentro de ventana capturado, antiguo fuera de ventana excluido; credenciales/cuentas/permisos/v1 conservados; deshabilitar/rehabilitar y cambiar generación no reinicia consumo. |
| FR03 / AC06 | RPC legado y reserva v2 compiten realmente; delta posterior capturado una sola vez; regresión del contador reciente bloqueada. |
| FR03 / AC07 | Replay exacto sin débito, conflicto si cambia tuple, cuota agotada sin nuevo consumo; límite/deadline inválidos rechazados; deadline y generación revalidados tras esperar un lock. |
| FR06 / AC12,13 | RLS y SELECT/INSERT/UPDATE/DELETE negados en siete tablas a anon/authenticated/service; helpers privados; RPC separados humano/servicio. Superadmin activo/MFA/exp/sesión comprobados antes de replay, incluido vencimiento durante espera. |
| FR06 / AC13 | Dos conexiones ante último cupo: una reserva, otra recibe agotado. Dos peticiones idénticas: un débito. `pg_stat_activity.wait_event_type='Lock'` observado, no se infiere concurrencia solo por una espera temporal. |
| FR07 / AC14 | Paridad I01/SQL de entradas estrictas y Google opcional, UUID canónicos incluidos nil/max; v1 command/page/replay tras expansión idénticos; v2 con FK, sin Google, sin confirmación heredada; referencias inmutables. |
| FR07 / AC15 | Publicación CAS, conflicto/replay/stale; cambio de generación/estado mientras otra conexión espera cancela la reserva; habilitación con operación runtime en vuelo rechazada. |
| FR03/07 / AC06,14 | Fallo final de instalación revierte DDL; fallo al insertar recibo revierte slots/contadores; reversa vacía restaura esquema; reversa con historia conserva todo, cierra y rechaza replay/eliminación. |

Durante revisión se corrigieron dos diferencias de borde: aceptación SQL de UUID
nil/max como I01, y representación del deadline en recibos. Se almacena epoch para
que el replay del mismo instante desde otra zona SQL no genere un conflicto falso;
regresión probada entre zona habitual y Asia/Tokyo. También se exige `exp` numérico.

## Preservación, límites y siguiente incremento

Baselines SHA256 coinciden con manifest.json: tracked
`f057cf4d67d1a06258888e751a670d3f43913890f5dd14685ff2e18f583f2c83`,
untracked previos `881d5fb62bce863cee7ca5cb6a1738e0e938748e3a57eb3568a915afd8fec255`.
Hash de cada fuente nueva y evidencia nativa en `manifest.json.secondIncrement`.

Gmail directo conservado; Composio productivo apagado; Instantly43/0 nuevas. Cero
APIs de proveedor, envíos, cambios remotos, push o despliegues. No se abrieron env reales.

Este ensayo prueba el delta SQL y concurrencia PG15, no aceptación end-to-end de los20
AC. Siguen pendientes: cubrir todos los callers/admisiones Gmail en I03, revalidación
humana/capacidad después del pacing antes del wire, fuente revisada de grants efectivos,
conciliación F2 para Connect/UI, QA integral y migración final versionada/rollout.
La captura SQL no detiene HTTP externo; habilitar en el futuro exige pausa operativa
y todos los callers integrados. Locks globales/de tablas son conservadores; no se
certifica throughput productivo o consumo de clientes Google externos.

No se generan tipos de producto ni se cambia la fachada porque no hay caller nuevo;
esa integración se hará junto a I03 y la migración final. No se repiten recepción,
adjuntos o importación aceptados, ni builds web/worker por SQL sin integrar.

Siguiente paso: preparar I03 para conectar la política con los callers y versionar la
comprobación de la conexión existente. No hace falta aplicar SQL remoto para cerrar I02.
