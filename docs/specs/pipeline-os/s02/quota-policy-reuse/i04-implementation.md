# I04-A/R — implementación local

SDD STRICT · autorización del usuario: implementar A/R como un paquete y probarlo
localmente. FR/AC y decisiones previas: [plan](i04-plan.md). No se agregan preguntas
de negocio: se reutilizan las decisiones ya confirmadas de I01–I03.

## Resultado e impacto

La web puede registrar un candidato v2 sin inventar un proyecto Google, comprobar
la conexión existente con el adaptador tokeninfo de I03 y confirmar explícitamente
la asociación. El worker y la fachada de Gmail entienden el ticket v2 y su política
compartida. Ninguno de estos pasos selecciona Composio automáticamente.

Se conserva v1 mediante contratos discriminados y copias privadas de los cuerpos
SQL anteriores; se mantienen los drenajes, CAS, recibos, nonces y separación de
roles. No se editan las fuentes de Connect ni los SQL sellados de I02/I03 o
048–051. El selector y el scheduler siguen compartidos por web y worker.

## Diseño aplicado / ADR-I04-01

- Un módulo puro de contexto v2 mantiene el hash de I03 sin importar verificadores
  ni clientes administrativos en el transporte. El binding resuelto es una unión
  estricta v1/v2: v2 exige política/generación y `quotaProjectId:null`.
- Las rutas existentes discriminan `contract_version:2`. Una versión desconocida
  se rechaza; no se reinterpreta como v1. `/composio/check` solo admite POST JSON
  acotado, Origin, sesión/MFA y superadmin, y conserva `request.signal`.
- La base acredita actor/sesión antes de crear el cliente de servicio o leer el
  descriptor. Registrar publica únicamente el contexto revisado del servidor.
  GET no publica contexto, crea presupuesto, comprueba permisos ni lee la clave.
- El presupuesto de hasta4 peticiones se prepara mediante RPC humana/MFA,
  confirmación de cupo, clave idempotente y caducidad máxima30min. No hay botón
  que lo conceda o renueve automáticamente; su preparación privada corresponde
  al protocolo posterior. Una admisión se confirma en PostgreSQL antes del wire.
- El check dura como máximo30s. Cada consulta revalida contexto, permiso y nonce.
  El recibo usa el vencimiento efectivo observado por tokeninfo; persistirlo no
  reinicia su TTL. El check completado deja el binding candidato. Solo una
  confirmación humana, de la misma sesión y aún vigente, puede verificarlo.
- El cambio de proveedor sigue siendo un comando distinto con drenaje. La
  aprobación operativa conserva contexto, política, generación y actor revisados;
  su uso no depende del viejo proyecto Google. Cerrar la política bloquea nuevas
  emisiones y permite volver al directo cuando ya no existen intentos pendientes.
- La UI muestra registro, comprobación y confirmación por separado, conserva una
  clave de intención ante error y protege borradores, teclado, foco y paginación.
  El indicador no sensible `mail_binding_contract_version` permite elegir el
  panel v2 desde Workspace sin enviar configuración privada al navegador.

## Archivos principales

| Área             | Archivos                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO y transporte | `src/lib/composio-bindings-v2.ts`, `mail-transport/{resolved-binding,verification-context-v2,runtime-context,selection,contract,composio-proxy}.ts` |
| Servicio y HTTP  | `mail-accounts/composio-binding-v2.ts`, `composio-existing-verifier.ts`, rutas `accounts/[id]/composio` y `composio/check`                          |
| UI               | `composio-account-bindings-v2.tsx`, elección en Integrations y campo en Workspace                                                                   |
| Persistencia     | `migrations/quota-i04.local.sql`, fragmentos del generador, postflight y rollback locales                                                           |
| Pruebas          | `tests/pipeline-os-s02-quota-i04{,-http,-ui,-db}.test.ts`, fixture visual ficticio                                                                  |

Las rutas completas y huellas están en [i04-manifest.json](i04-manifest.json).
Las bases anteriores están conservadas en `i04-implementation-baseline.json` y
`i04-extra-baseline.json`; el WIP de I03 no se revierte ni se reemplaza.

## Verificación y trazabilidad

| Criterios del plan | Evidencia                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I04-AC01/02/12     | Huellas base/finales y dependencias selladas preservadas; v1 y v2 separados; no edición F2                                                                    |
| I04-AC03           | HTTP con sesión/MFA/admin/Origin negativos; autorización DB antes de descriptor/factory                                                                       |
| I04-AC04           | Replay sin clave ni wire, admisión durable, límite4 y contención de dos conexiones PG15                                                                       |
| I04-AC05/06        | Cadena TS→RPC PG15→provider ficticio→recibo→confirmación; nonce erróneo, sesión eliminada, contexto cambiado, política cerrada y recibo vencido               |
| I04-AC07/08        | SSR ES/EN y panel real en fixture local: anchos de contenido360/768/1280px sin desbordamiento; teclado, busy, foco alert y advertencia de borrador observados |
| I04-AC09/10        | Runtime v2 con lease agregado y los mismos IDs; corte simulado y vuelta al directo, bloqueo de unresolved; constante operativa Composio en false              |
| I04-AC11           | PG15.19 propio, RLS/ACL y postflight; ROLLBACK transaccional recupera catálogo/datos; reversa con datos conserva checks y contadores                          |

Resultados y comandos reproducibles: [i04-verification.md](i04-verification.md),
con evidencia estructurada en el manifiesto. Los mocks de proveedor no certifican
compatibilidad real de tokeninfo, vigencia de las credenciales o cupo del proyecto.
No se ejecutó build de producción ni smoke remoto; corresponden a I05.

## Operación, rollout y reversa

`COMPOSIO_BINDING_V2_ENABLED=false` y `COMPOSIO_BINDING_CHECKS_ENABLED=false` son
los valores documentados por defecto. `COMPOSIO_EXISTING_AUTH_CONFIG_ID` y el
contexto v2 son privados. No se abre ni modifica ningún archivo env real.
`composioProductOperationEnabled` permanece literalmente en false.

Los SQL de este paquete son candidatos bloqueados a fixtures PG15 locales; **no
ejecutarlos en producción**. El postflight es de solo lectura. El rollback local
exige retorno drenado al directo, cierra admisiones/cuota y revoca las nuevas RPC;
conserva tablas, evidencia, recibos y consumo. No es una desinstalación destructiva.
También se ensayó ROLLBACK completo de la instalación dentro de una transacción.

I05 debe componer un SQL final nuevo, sin repetir048–051, y revisar build conjunto,
catálogo, variables y publicación. Después se prepara la autorización de hasta4
consultas reales para Daniel y luego el corte piloto. I04-B para altas nuevas
continúa diferido. Gmail directo y las43 peticiones de Instantly se conservan.
