# DV-LIMIT-UI — implementación autorizada offline

11/11/2026 · SDD STRICT. Se implementa el incremento preparado en
limited-configuration.md. Se reutilizan las decisiones ya confirmadas: Daniel,
Curated Financial, Hobby, cuatro consultas, dos proxy, sesión superadmin/MFA,
Gmail directo y Composio operativo apagado. No hay pregunta de negocio nueva.

## Requisitos y aceptación

| FR / AC | Criterio verificable |
| --- | --- |
| CT-FR01 / AC01 | Ruta GET/POST limitada por flags y UUID servidor; otra cuenta/rol/sesión/MFA falla antes de descriptor o servicio. |
| CT-FR02 / AC02 | GET solo lee página/cabeza; devuelve propuesta/estado mínimo sin secretos, owner, credencial o JSON privado. Cero proveedor/escrituras. |
| CT-FR03 / AC03 | Publicar política exige confirmación de pausa, configuración/revisiones actuales y request_key estable. Política del servidor; RPC mediante cliente humano. |
| CT-FR04 / AC04 | Presupuesto exige candidato vigente, política exacta, checks/cuota habilitados, cupo confirmado y expiry exacto entre ahora y10min; maximum4 fijo, nunca del browser. |
| CT-FR05 / AC05 | Replay mantiene key/expiry y no repone consumo. El control no inicia check, OAuth, Gmail, envío, selección de transporte o worker. |
| CT-FR06 / AC06 | UI ES/EN con confirmación separada, estados vacíos/carga/error/listo, bloqueo de dobles clics y cambio de buzón durante intención; conservar borradores. |
| CT-FR07 / AC07 | Pruebas offline de servicio/HTTP/DTO/UI y RPC PG15 sintéticas, TypeScript/formato y revisión del delta; invariantes y artefactos052 intactos. |

## Diseño y límites

Dos adiciones a env.example, false/vacía: COMPOSIO_VERIFIER_SETUP_ENABLED y
COMPOSIO_VERIFIER_ACCOUNT_ID. Nuevos DTO, servicio, ruta y componente; conexión
pequeña al panel v2. Sin dependencias, migración, cambios al verificador/transporte
o SQL052. Se conserva el WIP documental anterior.

El descriptor servidor se valida con el contrato v2 existente; no se lee la API
key. El digest de revisión une contexto/auth config, cuenta y cabeza/candidato.
La cabeza de política se revisa por separado para permitir replay idempotente
después del primer publish. La RPC conserva el CAS de generación y consumo legado.
Una política ajena o un contexto cambiado falla cerrado.

El presupuesto se liga, según el contrato052 existente, a cuenta/contexto y
actor/sesión, no es una reserva de envío. Se comprueba candidato/cabeza antes de
concederlo; el check posterior conserva su propio CAS. No se inventa atomicidad
entre la lectura de candidato y la RPC de presupuesto ni se elimina esa guarda.
Un check previo requiere revisión/recuperación explícita, no auto-renovación.

GET no prepara contexto. El registro de candidato existente publica el contexto
por su camino ya revisado. La nueva concesión exige candidato/política actuales y
usa composio_binding_budget_v2 con db humano. Service_role solo lee snapshot.
La pausa y el cupo son confirmaciones del operador; ni GET ni UI los certifican
mediante métricas, permisos locales o un saldo inventado.

La intención cliente conserva key y expiry ante error ambiguo. No hay retries
automáticos. La caducidad se elige al revisar y no se recalcula al reenviar.
El presupuesto no se concede por render, polling, actualizar o cerrar modal.

## Tareas y pruebas

T01 cerrar discovery/contratos y baseline; T02 DTO/servicio/ruta; T03 controles UI;
T04 negativas/unit/HTTP/SSR; T05 integración PG15 y visual local360/768/1280;
T06 revisión, checks y evidencia. T01–T06 corresponden a CT-FR01–07.

T01–T06 completadas localmente. Resultados, comandos, límites y revisión en
[controls-verification.md](controls-verification.md); no equivalen a publicación.

Matriz: flags off/UUID ajeno/rol/MFA/Origin/query/cuerpo; descriptor inválido o
modificado; generación/candidato stale; pausa/cupo no confirmados; TTL/replay y
errores RPC saneados; GET/mutaciones con factories de key/fetch que fallan si se
tocan. SQL real sintético: identidad/MFA, publicación idempotente, transferencia
de uso legado y presupuesto4 sin reposición por replay.

## Rollout y reversa

Solo código/pruebas locales. Futuro: revisión/publicación autorizada del delta,
fase de preparación con checks/cuota false y workerpaused; política humana,
registro exacto y ventana/cupo autorizados antes del check. Sin repetir052.
Reversa local limitada a este delta; en remoto cerrar controles y conciliar
intentos, conservando políticas/recibos/consumo. No ejecutar rollback automático.
