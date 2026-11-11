# QGR-I03-TI-r1 — grants de Google mediante proxy Composio

10/11/2026 · SDD STRICT · implementación y pruebas offline autorizadas.
Extiende FR04/05/06/07/09 y AC08/10/11/12/15/18/19 de QGR. Las decisiones ya
confirmadas son: conexión original del buzón existente, owner intacto, readonly+send,
sin proyecto Google obligatorio, sin OAuth nuevo ni operación real. No hay dudas
nuevas de negocio. No cambia I01/I02, SQL sellado, UI, rutas o persistencia I04.

## CR-TI01 / decisión y fuentes

Sustituir el puerto real que devolvía null por una consulta de permisos concedidos
al token, sin usar `requested_scopes`, Auth Config scopes, `state.val.scope` ni
campos de grants aportados por el cliente como evidencia. No cambia el requisito
de acreditar ambos scopes; cambia su fuente concreta.

- [Google OAuth2Client.getTokenInfo](https://github.com/googleapis/google-cloud-node-core/blob/main/packages/google-auth-library-nodejs/src/auth/oauth2client.ts):
  POST fijo a `https://oauth2.googleapis.com/tokeninfo`, sin cuerpo, content-type
  form-urlencoded y Authorization Bearer. Lee `scope`, `expires_in` y `aud`.
  Se contrastó también con la biblioteca ya instalada, sin ejecutar su cliente.
- [Proxy v3.1](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy):
  Composio recibe connected_account_id, user_id, endpoint, method y parámetros.
  Se contrastó su OpenAPI público: cada parámetro REST exige `name`, `value`, `type`
  (`header`/`query`). No usar `in`, que aparece en otra interfaz del SDK.
- [Custodia](https://docs.composio.dev/docs/security/token-custody): credencial
  inyectada en servidor, no exportada; el destino absoluto debe conservar esquema
  y dominio registrado del base URL resuelto, permitiendo subdominios hermanos.

La composición tokeninfo+proxy es una inferencia de esos contratos, NO una prueba
real de que la configuración Gmail concreta permita ese destino o encabezado.
Un rechazo del proxy cierra el intento; no se cambia dominio, extrae token, renueva
OAuth o reintenta por otra ruta. El límite del producto sigue apagado.

## Contrato técnico y requisitos TI-FR

1. **TI-FR01 / destino y custodia.** HTTP exterior solo a backend.composio.dev/api/v3.1,
   x-api-key capturada e inmutable. Para grants se fija proxy con ca/owner exactos,
   endpoint tokeninfo anterior, method POST, header Content-Type form-urlencoded,
   sin body, Authorization manual, query, credential templates o custom_connection_data.
   Composio aporta Authorization. Nunca hacer fetch directo a Google ni leer tokens.
2. **TI-FR02 / autorización.** V2 activo, target estricto e inmutable, deadline y
   autorización fresca antes del wire, incluso después del guard de presupuesto.
   El callback beforeRequest es servidor e inyectado; cuenta cada intento Composio,
   incluidos fallos. No se carga env ni se crea cliente de producto automáticamente.
3. **TI-FR03 / prueba.** Exigir HTTP exterior 200, status interior 200 y data objeto
   sin error OAuth. Parsear scope como lista ASCII separada por espacios, máximo64
   scopes/16KiB; aud no vacío (no se afirma compararlo con un Google client desconocido).
   expires_in entero positivo, número o decimal string; exp opcional entero positivo.
   Si aparece email, debe coincidir y no estar explícitamente sin verificar. Descartar
   campos desconocidos y no devolver claims personales, headers o credenciales.
4. **TI-FR04 / vigencia.** Usar reloj servidor inyectado y tiempo anterior a la consulta,
   nunca el header Date remoto. Evidencia válida hasta min(inicio+60s,
   inicio+expires_in*1000, exp*1000 si existe). Validar reloj seguro/no regresivo y
   vencer antes del perfil si se consume ese plazo. Los60s son frescura interna,
   no una caducidad afirmada por Composio. Normalizar con referencia fija de contrato,
   tuple/revisión leídas y versión de credencial capturada al crear adaptador.
5. **TI-FR05 / cierre.** Solo ambos scopes exactos permiten llegar al perfil bajo su
   reserva Gmail existente. Tokeninfo no es un método Gmail y no debita unidades
   Gmail, pero sí consume una petición Composio y conserva deadline/guard propios.
   Ausencia/forma/scopes/expiración inválidos → permission_unproven; transporte,
   autorización denegada, error o timeout → fallo saneado y no perfil/aprobación.

Metadata→config→tokeninfo→perfil. El verificador puro mantiene autorización/contexto
antes y después de awaits. No acepta evidencia del navegador ni confirma bindings.
I04 conserva aprobación humana, comandos/DTO/SQL v2 y conciliación F2. No introducir
`use server` para exponer el adaptador como Server Action; permanece biblioteca
backend siguiendo la guía local Next de datos/DTOs.

## AC y tareas

| AC      | Given / When / Then                                                                                                                                    | Tarea / prueba                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| TI-AC01 | Con respuesta Google válida, grants contienen solo tuple, procedencia, scopes y plazo local; el recorrido completo ficticio pasa con4 HTTP exteriores. | TI-T01 contrato; TI-T02 adaptador; test feliz/composición |
| TI-AC02 | Si faltan scopes, hay error, expires_in/exp inválidos o email ajeno, bloquea antes de perfil y no usa scopes declarados como fallback.                 | TI-T02/T03 negativos                                      |
| TI-AC03 | Con revocación, contexto/deadline cambiado, aborto o flag off antes de wire, no sale tokeninfo; ningún token/URL externa controlable entra al body.    | TI-T02/T03 autorización y forma                           |
| TI-AC04 | Si proxy devuelve 302/4xx/5xx/HTML/JSON inválido/stream excesivo o no responde, hace un intento, error saneado, sin perfil ni retry.                   | TI-T03 límites/transporte                                 |
| TI-AC05 | Si grants vencen durante lectura/pacing/perfil, jamás pasan; exp corto limita60s y latencia no alarga la vida del token.                               | TI-T03 reloj/revisión                                     |
| TI-AC06 | Gmail directo, políticas/SQL anteriores, env y Composio apagado siguen intactos; sin red de negocio o cluster nuevo.                                   | TI-T04 regresiones, typecheck, hashes y review            |

TI-T01 especificación antes de código; TI-T02 adaptar provider/puerto de verificador;
TI-T03 fixtures falsos que rechazan cualquier wire inesperado; TI-T04 revisión
safe-code-review, regresiones relevantes, TypeScript/formato y evidencia real.

## Presupuesto y entrega

Futuro por intento: GET conexión1 + GET config1 + proxy tokeninfo1 + proxy perfil1
=4 peticiones Composio normales; reserva diagnóstica opcional1, máximo propuesto5.
Cualquier uso real necesita autorización y cupo confirmados. Hoy autorizadas0;
Instantly43/0 nuevas. No certificar cupo Hobby o costo por pasar mocks.

Rollback: retirar solo el delta TI contra i03-tokeninfo-baseline.json y dejar grants
cerrados; conservar WIP y reservas/contadores, sin reset/stash/clean. No hay SQL,
configuración en vivo o despliegue que revertir. No se repiten pruebas operativas
ya aceptadas. Sin UI/DDL nuevos: QA visual y nuevo ensayo PG no aplican a este delta;
regresión de cuota sí. Publicación y prueba real siguen pendientes.
