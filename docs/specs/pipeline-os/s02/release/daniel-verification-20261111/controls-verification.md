# DV-LIMIT-UI — evidencia de implementación offline

11/11/2026 · SDD STRICT · base2730d2731ec871e80d3393f5c48d059496d95bb2.
Estado: implementado localmente; publicación, configuración y check real pendientes.

## Resultado

Se añadieron DTO, servicio, ruta GET/POST y controles administrativos al panel v2.
GET solo consulta. Publicar política y conceder presupuesto usan el cliente humano
con sesión superadmin/MFA, no service_role. El servicio solo lee snapshot después
de autorizar la cuenta. Flag temporal false por defecto y UUID objetivo servidor.
No recibe política, maximum, actor, sesión, pruebas o credenciales del navegador.

Presupuesto fijo4, TTL máximo10min, confirmación de cupo incluido y dos llamadas
proxy disponibles. No certifica saldo mediante métricas genéricas. La política
es exactamente la del descriptor v2 servidor, con CAS de generación existente.
La revisión opaca también invalida cambios de cuenta, candidato, contexto y check.
No concede presupuesto si hay un check anterior; su recuperación queda separada.
Las RPC mantienen la validación definitiva y la admisión del verificador conserva
su CAS. La lectura previa del candidato y la concesión no son una transacción única.

## Trazabilidad y resultados observados

| AC | Evidencia |
| --- | --- |
| 01 | Flags/UUID objetivo, rol activo, sesión, MFA, Origin, parámetros y cuerpo; rechazos antes de descriptor/servicio. Pruebas unitarias, HTTP y roles PostgreSQL reales sintéticos. |
| 02 | GET sin escrituras; respuesta no contiene correo, project/auth config, owner, credencial ni descriptor. Factories de key/fetch fallan si se tocan. |
| 03 | Política solo servidor, pausa explícita, generación y revisión vigentes. Publicación y replay humanos en PG15 conservan17 unidades ficticias previas y un único recibo. |
| 04 | maximum4 fijo; expiry exacto futuro≤10min; candidato/política/checks/cuota válidos. Casos negativos y cambio de check durante autorización final. |
| 05 | Replay conserva clave/expiry. PG15 mantiene used2 sin reponerlo ni alterar actor/sesión. No se creó check ni outbox en esos escenarios. |
| 06 | UI ES/EN, casilla obligatoria, foco en error, botones/buzón bloqueados, intención estable y guardas de borradores. Fixture local con contenedores360/768/1280, sin overflow horizontal observado. |
| 07 | TypeScript, formato, diff y revisión del delta; fuentes existentes y052 preservadas. Sin dependencias ni migraciones nuevas. |

Comando del paquete y regresiones (Node22.23.4 ya disponible):

```powershell
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import ./.local/pipeline-os/s02-i01/offline.mjs --import tsx --test --test-concurrency=1 tests/pipeline-os-composio-verification-setup.test.ts tests/pipeline-os-composio-verification-setup-http.test.ts tests/pipeline-os-composio-verification-setup-ui.test.tsx tests/pipeline-os-s02-quota-i04.test.ts tests/pipeline-os-s02-quota-i04-http.test.ts tests/pipeline-os-s02-quota-i04-ui.test.ts
```

Resultado: **27/27**, sin fallos ni omitidas. Incluye17 pruebas del delta y10
regresiones relacionadas con contratos, panel, verificador y transporte.
El HTTP usa mocks de sesión y RPC; las respuestas del proveedor son simuladas.
No se repitieron pilotos aceptados de recepción, adjuntos o importación.

PG15 nativo: `tests/pipeline-os-composio-verification-setup-db.test.ts`, opt-in
`PIPELINE_OS_DV_SETUP_NATIVE=1`; `PIPELINE_OS_QGR_PG_BIN` apunta únicamente a
los binarios15.19 portátiles ya autorizados. Clúster nuevo y datos ficticios de
este checkout en `.local/pipeline-os/dv-setup/runs/**`, solo127.0.0.1. No se abrieron
datos/env de F2 ni se instaló nada. Se preparó un esquema sintético con el SQL052
sellado sin regenerarlo ni repetir su suite de aceptación. Después se probaron
los nuevos callers y sus roles contra PostgreSQL real.

Los cuatro escenarios nuevos verifican lectura/MFA, publicación/conservación,
registro ficticio compatible y presupuesto/replay. Evidencia propia `result.json`
incluye versión150019 y `clusterStopped:true`. El bloqueo global de red de las
pruebas unitarias también impide escuchar en loopback: un intento con ese guard
se detuvo antes de iniciar PostgreSQL. El ensayo nativo usa su entorno mínimo y
puerto local comprobado, con key/fetch explícitamente prohibidos en sus ports.

Checks adicionales: `tsc --noEmit`, Prettier de los12 archivos del delta y
`git diff --check`, satisfactorios. No se ejecutó otro build/release de producción;
la compilación de publicación y validación de despliegues corresponden al siguiente
paso autorizado. No se certifica comportamiento remoto a partir de estas pruebas.

## Revisión de código y preservación

Revisión del diff en modo revisión con safe-code-review: acceso por cuenta,
autorización humana, guardas del descriptor, DTO estricto, saneamiento de errores,
generación, TTL, idempotencia y bloqueo UI. Se corrigió durante la implementación
la revisión de checks aparecidos entre lecturas y la disposición de la casilla.
Sin hallazgos pendientes confirmados en este alcance. No se revisó infraestructura
remota, saldo del proveedor, OAuth real o corte de transporte.

Baseline SHA256 de todos los archivos versionados guardado antes del cambio.
Solo cambiaron `.env.example` y `src/components/composio-account-bindings-v2.tsx`;
el resto del delta son archivos nuevos propios. No se cambió SQL052 ni contratos,
transportes, worker, manifests/lock, AGENTS o frentes ajenos. WIP documental previo
conservado. Referencia local de comparación: `.local/pipeline-os/dv-setup/preservation.json`.

Gmail directo conservado, `composioProductOperationEnabled=false`. Instantly43;
**0 llamadas reales a proveedores, 0 envíos, 0 cambios remotos, 0 push/deploy**.
Preview local detenido y clúster propio detenido al finalizar. No se abrió ningún
archivo env real ni se mostraron secretos.

Captura del modal con datos ficticios:
`C:/Users/Usuario/Desktop/Projects/CRM Currated/.local/pipeline-os/dv-setup/visual/budget-confirmation.png`.

## Siguiente paso

Preparar publicación de este delta, confirmar al menos2 Proxy Execute incluidos
disponibles y costo adicional0 en el ciclo correcto. Luego aplicar únicamente la
configuración limitada autorizada de la web y usar la sesión real MFA para política,
candidato y presupuesto. El check real de4 requiere autorización separada; no activar
routing ni transporte Composio, reanudar worker o repetir052 por este incremento.
