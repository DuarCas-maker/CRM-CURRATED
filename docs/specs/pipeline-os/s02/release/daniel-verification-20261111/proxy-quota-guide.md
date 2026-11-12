# Cómo acreditar el cupo de proxy para Daniel

11/11/2026 · consulta de información pública, sin API autenticada. No contratar
Pro, recargar créditos, usar Instant Tools o ejecutar un proxy para probar saldo.

Necesitamos que el proyecto/organización de la clave guardada disponga de **al
menos2 ejecuciones Proxy Execute incluidas**, sin costo adicional, en el ciclo
vigente. Las otras2 peticiones del check son GET de metadatos. La consulta previa
del Auth Config ya se ejecutó y no se repite; el check conserva su presupuesto4.

## Qué revisar

1. En Platform, seleccionar la organización/proyecto de esa conexión y abrir
   Organization Settings → Billing. Comprobar el plan aplicable y las fechas del
   ciclo. La elección previa del operador es Hobby; no cambiarla.
2. Si ese Billing ofrece un desglose explícito de Proxy Execute, guardar el límite,
   utilizado/restante, ciclo y organización. Debe permitir al menos2 incluidas.
   No afirmar que ese desglose existe en todas las variantes del panel.
3. En las capturas reales de Usage, Metrics solo contiene Tool calls, Errors,
   Sessions y Active users. Ahí no se acredita el subcupo proxy: no seguir buscando
   un filtro que no aparece ni restar52/27.3K de1000 como si fueran el mismo contador.
4. Si Billing tampoco expone ese dato, pedir confirmación a Support de Composio o
   a support@composio.dev. El operador puede enviar el texto inferior; el agente
   no lo ha enviado y no tiene autorización para hacerlo.

## Texto sugerido para soporte

> Uso Platform con el plan Hobby y una conexión Gmail de Auth Config Custom.
> Quiero hacer un único ensayo: dos GET de metadatos y dos Proxy Execute
> (tokeninfo de Google y perfil de Gmail), sin envíos ni Instant Tools.
> ¿Pueden confirmar que tengo al menos dos Proxy Execute incluidas disponibles
> en mi ciclo actual, sin costo adicional, indicar las fechas del ciclo y dónde
> puedo consultar ese consumo? Si mi organización conserva un plan anterior,
> indiquen qué cupo de proxy se aplica a mi organización/proyecto.

Indicar a soporte la organización/proyecto desde la sesión habitual. No adjuntar
API keys, tokens, cookies, env privados o datos de correos/clientes. No enviar
mensajes desde la app para comprobar cupo.

## Evidencia suficiente

- Desglose explícito del contador proxy y su ciclo/plan, con saldo mínimo2; o
- Confirmación de soporte para la organización/proyecto correcto, con esas dos
  llamadas incluidas disponibles y costo adicional0 en el ciclo vigente.

Registrar referencia/fecha y hechos mínimos en el manifiesto privado; el operador
confirma `included_confirmed` al conceder el presupuesto. No marcarlo true solo
por disponer de clave, estado ACTIVE/ENABLED o un saldo monetario de Instant.

## Fuente pública y límites

La tarifa oficial de Platform consultada indica proxy1000/mes en Hobby y parada
al límite, y trata Proxy Execute como una ejecución con su partida adicional:
https://composio.dev/pricing/platform. La misma página menciona planes anteriores
conservados temporalmente; el plan/ciclo/saldo propios necesitan evidencia de la
cuenta. Fuente de contacto oficial: https://composio.dev/pricing.

Estos datos no certifican el saldo del usuario ni garantizan que tokeninfo sea
aceptado por el proxy de ese Auth Config. Un rechazo se cuenta y detiene el check,
sin reintentos, cambios de dominio o extracción de credenciales.
