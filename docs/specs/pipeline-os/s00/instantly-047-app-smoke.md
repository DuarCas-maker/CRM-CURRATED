# R47-T05a: smoke HTTP de fb9f201 con webhook apagado

30/10/2026, America/Bogota. Usuario autoriza hasta6 peticiones a `https://crm.finlabinc.com`, conservando43 de Instantly, sin activar webhook, enviar mensajes, SQL remoto u otro despliegue. [Publicación y evidencia del operador](instantly-047-publication.md), [protocolo](instantly-047-release-runbook.md). No se amplía el permiso de C ni se utiliza una sesión autenticada.

## Ejecución y resultados

Se ejecutaron exactamente **6 peticiones cliente**, una por ruta, secuenciales. Transporte HTTPS nativo con validación TLS/host, sin redirects, retries, cookies, Authorization, credenciales, cuerpo POST o carga de `.env`. Nonce ficticio de24 ceros; no se prepara un trial. Reserva durable por intento antes de HTTP, límite6 y detención ante error; sin navegador/JS/assets. La evidencia conserva estados, tamaños y comprobaciones booleanas, sin HTML completo, headers privados o cookies.

| #   | Método / ruta                                                                  | Resultado | Comprobación                                                           |
| --- | ------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------- |
| 1   | GET `/api/health`                                                              | 200       | JSON exacto status=ok/service=curated-crm.                             |
| 2   | GET `/login`                                                                   | 200       | HTML de formulario con campos email/password; sin envío de formulario. |
| 3   | POST vacío `/api/integrations/instantly/webhook/000000000000000000000000`      | 404       | Cuerpo vacío/no-store.                                                 |
| 4   | GET `/api/integrations/instantly/trials/000000000000000000000000`              | 404       | Cuerpo vacío/no-store.                                                 |
| 5   | GET `/api/integrations/instantly/control/000000000000000000000000`             | 404       | Cuerpo vacío/no-store.                                                 |
| 6   | POST vacío `/api/integrations/instantly/trials/000000000000000000000000/lease` | 404       | Cuerpo vacío/no-store; no emisión de permiso.                          |

**6/6 correctas.** Todas las respuestas contienen no-store, X-Content-Type-Options=nosniff, X-Frame-Options=DENY y Content-Security-Policy. Ninguna redirección o retry. Se consumió todo el techo autorizado de6, por lo que este smoke no se vuelve a ejecutar ni se completa con llamadas extra por este permiso.

Antes de la ejecución se comprobaron12 casos positivos/negativos del validador con respuestas ficticias (0 red) y la integridad de fuente/código. Antes/después: **43/v7 y12 JSON operativos idénticos**, payload20 idéntico al validado, HEADfb9f201. Estado privado durable `app-smoke-state.json` final passed/calls6; sin locks/tmp pendientes. No se guardan respuestas completas o datos personales en documentación/recibos.

## Aceptación y límites

R47-T05a HTTP completada. Este comportamiento es compatible con la bandera apagada y con las guardas revisadas del código; no se comprobó internamente el número de consultas DB del servidor. La atribución de versión se combina con mainfb9f201 verificado y Success/Finished/healthy reportado por operador. Un404 aislado también podría provenir de una ruta ausente; el smoke no certifica por sí solo la imagen exacta.

Health200 y formulario200 no acreditan login/MFA, permisos o cifras de vistas. No se probó RPC/PostgREST, autenticación/grant, recepción, payload/contexto/log, ni retención actual de la imagen de recuperación. Permanecen pendientes las comprobaciones manuales posteriores de sesión/vistas e imagen0af77b7 retenida. No se declara toda R47-T05, C/D/S00 completadas.

Balance: **6 HTTP app,0 Instantly,0 SQL remoto,0 envíos,0 activaciones,0 despliegues o cambios de variables en este incremento**. El tráfico habitual del servidor/healthchecks del despliegue no forma parte del conteo de estas seis solicitudes cliente. Se mantienen047 aplicada y su catálogo aceptado; no se repite SQL. No se crean nonce/ventana/ticket reales, secretos, manifiesto ejecutable C o journal v9.

Evidencia/guía actualizadas solo localmente, sin nuevo commit/push/autodeploy. La QA681/DB/TS/build conserva su alcance anterior sobre el mismo payload; no se repite por hacer este smoke. Ante futuros errores se conserva la evidencia y se sigue el runbook autorizado, sin restaurar contadores o forzar despliegues.
