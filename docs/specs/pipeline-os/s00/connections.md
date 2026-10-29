# S00: comprobación de conexiones sin envíos

Fecha: 25 de octubre de 2026. SDD STANDARD para el comprobador local; continúa el alcance global STRICT. Modo implementación de herramienta de diagnóstico dentro de S00. El usuario autorizó consultar conexiones actuales sin enviar mensajes ni generar costos. No se modifica la aplicación ni se arranca el worker.

## Especificación

| Requisito  | Aceptación                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S00-C-FR01 | Consultar únicamente metadatos de autenticación de Composio, Instantly y TextTorrent mediante seis GET como máximo. S00-C-AC01: lista cerrada de rutas, sin red por defecto, sin redirecciones ni reintentos automáticos.                                                                                                                                           |
| S00-C-FR02 | Relacionar configuración y dos conexiones Gmail distintas; comprobar toolkit, estado y config esperada. Instantly compara el workspace si se proporcionó su ID. TextTorrent usa la administradora y omite act-as para esta primera comprobación. S00-C-AC02: 200 con identidad distinta, estado inactivo o estructura desconocida no cuenta como conexión correcta. |
| S00-C-FR03 | No cargar archivos privados desde la herramienta, no imprimir secretos, IDs, correos, números, cuerpos de mensajes o errores externos. S00-C-AC03: credenciales solo por entorno del proceso, reporte de campos fijos, respuestas limitadas y descarte de cuerpos de error.                                                                                         |
| S00-C-FR04 | Separar autenticación de capacidad operativa/costo. S00-C-AC04: no ejecutar tools/proxy/triggers de Composio, campañas, warmup, verificación Bouncer, compra de números, SMS o consultas de conversaciones. Un 402/429 se reporta sin comprar ni reintentar.                                                                                                        |
| S00-C-FR05 | Preservar configuración Supabase/Bouncer existente. S00-C-AC05: no solicitar otra copia de sus claves, ni cargar `.env.local`, ni enviarles solicitudes en esta comprobación de las tres integraciones nuevas.                                                                                                                                                      |

El usuario informó que ya guardó clave/configuración/dos cuentas Composio, Instantly y las credenciales de la administradora TextTorrent, con act-as vacío. Es información declarada, no autenticación comprobada. Los destinatarios de prueba no se usan en esta fase.

Dos IDs `ca_` distintos pueden autorizar el mismo buzón. Si Composio devuelve la dirección en `state.val.displayName`, se compara únicamente en memoria y se rechaza el duplicado. Si falta esa identidad, el reporte deja `distinctGmailMailboxesVerified=false` aunque los metadatos de ambas conexiones sean válidos; nunca se presume que dos IDs equivalen a dos buzones diferentes.

Durante la ejecución autorizada, Node encontró solo la clave Composio con contenido y el resto de campos vacíos, sin problemas de valores multilínea detectados. Para no bloquear la comprobación de esa clave, se permite alternativamente un GET a `https://backend.composio.dev/api/v3.1/auth_configs?limit=1`. Solo comprueba acceso al proyecto: si responde con una página válida, `apiAuthenticationVerified=true` pero el check sigue `missing_config`. No elige ni copia IDs automáticamente y no lee otras cuentas. Sustituye a la consulta por ID cuando faltan referencias; no se suma a ella y mantiene el máximo de seis GET por ejecución.

La consulta real recibió 401 y la revisión de formato detectó un valor `ac_` en el campo de API key. Se añade validación local para rechazar IDs `ac_`/`ca_` usados como clave, también en la ruta alternativa, antes de cualquier solicitud. El valor privado no se copia ni se corrige automáticamente. Una clave con otro formato sigue requiriendo autenticación real; este guard no valida ni inventa prefijos de API keys.

## Diseño y contrato de red

El módulo `s00-connections.ts` recibe una lista conocida de variables del proceso y una función fetch sustituible en tests. `s00-connections-cli.ts` solo permite `--execute-readonly`; sin ese flag no realiza solicitudes. No contiene lector de archivos `.env`, llamadas al código de la aplicación ni dependencias nuevas. Los fallos de un proveedor no impiden revisar otro.

| Check                | GET y credencial                                                             | Evidencia válida                                           | Límites                                                                                          |
| -------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| composio_auth        | `https://backend.composio.dev/api/v3.1/auth_configs/{id}`; `x-api-key`       | ID esperado, Gmail, OAuth2, ENABLED.                       | No devuelve credenciales ni campos libres del payload.                                           |
| composio_mailbox_1/2 | `https://backend.composio.dev/api/v3.1/connected_accounts/{id}`; `x-api-key` | ID/config esperados, Gmail, ACTIVE, no deshabilitada.      | Dos IDs distintos; sin ejecutar Gmail. Dependientes de auth config válida.                       |
| instantly_workspace  | `https://api.instantly.ai/api/v2/workspaces/current`; Bearer                 | Workspace identificado; si hay ID esperado debe coincidir. | Sin ID esperado, autenticación observada pero destino sin fijar.                                 |
| instantly_accounts   | `https://api.instantly.ai/api/v2/accounts?limit=1`; Bearer                   | Página con estructura de cuentas válida.                   | Solo cantidad de la muestra; no total de buzones ni contenido. Dependiente del workspace válido. |
| texttorrent_identity | `https://api.texttorrent.com/api/v1/user/auth/me`; SID/public key            | Respuesta de éxito con identidad válida.                   | Sin `X-ACT-AS-USER`; no enumera ni lee mensajes de las siete cuentas.                            |

GET no es una garantía universal de ausencia de efectos: por ejemplo, TextTorrent documenta que consultar mensajes puede marcarlos como leídos. Por eso el comprobador no tiene ninguna ruta de inbox. Tampoco incluye endpoints de ejecución o facturables; consume solicitudes del límite API. No se promete saldo ni costo medidos por una prueba simulada, y no se cambia un plan si el proveedor exige pago.

Protecciones: rutas y hosts constantes, IDs de Composio con prefijos/formato validados antes de construir URL, timeout por consulta, cuerpo JSON máximo de 128 KiB, redirecciones rechazadas, errores clasificados sin texto externo y encabezados enviados únicamente al proveedor correspondiente. El reporte contiene claves/enums fijos, booleanos y contadores. No persiste respuestas ni hashes de datos personales.

Supuestos: la clave de Instantly es V2; los IDs Composio pertenecen al proyecto de la clave; la cuenta TextTorrent es la administradora confirmada. Las diferencias reales se reportan como tales. ACTIVE de Composio no prueba que Google acepte ejecutar una acción ni que la recepción llegue cerca de un minuto.

## Tareas y verificación

| Tarea     | Dependencia                  | Terminada cuando                                                     | Prueba                                                                                         |
| --------- | ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| S00-C-T01 | T00-03–T00-05                | Contratos oficiales, alcance y rutas permitidas documentados.        | Revisión de fuentes y configuración declarada.                                                 |
| S00-C-T02 | S00-C-T01                    | Comprobador y CLI sin red por defecto, sin cargar archivos privados. | Éxito, configuración ausente/incorrecta, duplicados, identidad/estado incorrectos.             |
| S00-C-T03 | S00-C-T02                    | Manejo de errores y privacidad comprobados antes de red real.        | 401/402/403/404/429/5xx, timeout, redirección, JSON inválido/grande, redacción y comandos CLI. |
| S00-C-T04 | S00-C-T03 y acceso permitido | Se realizan los GET autorizados y se registra resultado sanitizado.  | Evidencia real separada de fixtures. No se declara conectividad si falta acceso.               |

Las reglas Duarte de `C:/Users/Usuario/.codex/AGENTS.md` dicen: «No abrir archivos `.env` con valores reales». El proceso heredado del agente no tiene las variables examinadas. Antes de ejecución real se requiere una excepción explícita para que el runtime cargue las credenciales en memoria sin mostrarlas, o que el usuario ejecute el comprobador en su propio proceso. Esta preparación no interpreta el permiso general de validar como excepción silenciosa a esa regla.

## Fuentes y límites de lo documentado

- [Composio Auth Config](https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigsByNanoid) y [Connected Account](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid): consultas por ID con clave de proyecto. Las estructuras publicadas de [v3](https://docs.composio.dev/reference/v3/api-reference/connected-accounts/getConnectedAccountsByNanoid) sirven de referencia; el [changelog](https://docs.composio.dev/reference/changelog) indica compatibilidad de rutas que no ejecutan tools entre v3/v3.1.
- [Instantly workspace](https://developer.instantly.ai/api-reference/workspace/get-workspace) y [lista de cuentas](https://developer.instantly.ai/api-reference/account/list-account): Bearer, alcance de lectura, paginación y posibles respuestas 402/429.
- [TextTorrent API, autenticación y subcuentas](https://texttorrent.com/docs/api): identidad `/me`, par de encabezados y act-as opcional. No se prueba acceso de las subcuentas con la identidad de la administradora.

## Entrega y reversión

Resultados de tests y comprobaciones reales en [verification.md](../verification.md). Reversión: retirar únicamente el comprobador, tests y notas de esta continuación. No hay SQL, datos de aplicación, configuración privada ni recursos remotos que revertir. S00 sigue abierto para recepción/adjuntos, latencia, detención de seguimientos y pruebas autorizadas posteriores.

## Comandos preparados

Desde la raíz, comprobación segura por defecto (el agente ya la ejecutó; cero solicitudes):

```powershell
& '.\.local\toolchains\node-v22.23.4-win-x64\node.exe' --import tsx scripts/pipeline-os/s00-connections-cli.ts
```

Para el proceso del usuario, o exclusivamente después de una excepción explícita a la regla de archivos privados, el comando de consultas reales es:

```powershell
& '.\.local\toolchains\node-v22.23.4-win-x64\node.exe' --env-file=.local/pipeline-os/s00.env --import tsx scripts/pipeline-os/s00-connections-cli.ts --execute-readonly
```

Este comando no carga `.env.local`. El flag de Node provisiona el proceso; el módulo no lee archivos. Código 0 con `--execute-readonly`: los seis contratos de metadatos pasaron; 2: algún check falló o falta configuración; 1: error de entrada controlado por el CLI. Sin el flag de ejecución, 0 solo significa que el modo offline terminó. El reporte no imprime valores y `operationalReadiness` sigue sin probarse. Un workspace Instantly sin ID esperado se señala como no fijado, no como coincidencia de destino demostrada.

## Ejecución real autorizada y resultado

El usuario concedió explícitamente la excepción para carga interna de `.local/pipeline-os/s00.env` y las consultas GET. No se abrió su contenido en herramientas de lectura ni se imprimieron valores; Node cargó el archivo en el proceso. La primera ejecución terminó con cero solicitudes porque faltaba configuración. Los controles de presencia mostraron solo `COMPOSIO_API_KEY` con contenido; IDs Composio, Instantly, TextTorrent y destinatarios estaban vacíos. No se detectaron valores multilínea o asignaciones incrustadas en los campos examinados.

El intento de consulta alternativa falló en sandbox sin respuesta HTTP. Una comprobación pública HEAD sin credenciales aisló un problema DNS (`ENOTFOUND`). Se repitió la consulta autorizada fuera del sandbox con aprobación automática: Composio respondió 401. La comprobación de formato detectó que `COMPOSIO_API_KEY` tiene prefijo `ac_`, correspondiente a un Auth Config ID; el valor privado no se mostró, copió ni cambió.

Resultado: autenticación Composio no válida con la asignación actual; cuentas Gmail no comprobadas por falta de IDs. Instantly/TextTorrent no consultados por campos vacíos. No hubo envíos, compras, verificaciones pagas, ejecución de tools ni modificaciones remotas. Dos intentos del comprobador (uno sin resolución DNS y otro con HTTP 401), más una comprobación pública sin credenciales; no se reintentó automáticamente tras 401. El reporte final sanitizado está en `.local/pipeline-os/s00-connections-result.json` (ignorado).

Pendiente: el usuario debe confirmar el archivo donde guardó los valores y corregir su asignación. No faltan permisos de ejecución de lectura ni una nueva copia de Supabase/Bouncer. Después se puede repetir el mismo alcance autorizado sin volver a solicitar esa excepción. No se considera que S00 esté cerrado.

## Revisión posterior del archivo corregido

Se confirmó que ahora hay credenciales y referencias en todos los campos requeridos. La clave Composio ya está en su variable correcta. Instantly respondió 200 para el workspace esperado y la muestra de cuentas. Consultas acotadas a la configuración Gmail y a la primera conexión Composio respondieron 200 con IDs esperados y conexión ACTIVE, custom OAuth y usuario Playground.

Los dos campos de Connected Account ID contienen el mismo valor; no se cambia ni se deduce un segundo ID. El validador completo continúa rechazando ese duplicado. La prueba individual permite acreditar un buzón, no dos.

TextTorrent responde 405 al GET `/me` publicado en su documentación, también al añadir Content-Type JSON; la respuesta declara `Allow: POST`. No se hicieron POST, no se adivinan endpoints ni se interpreta el 405 como clave inválida. El próximo experimento propuesto es una única consulta POST al mismo endpoint de identidad, sin cuerpo y sin act-as, con los dos encabezados de autenticación existentes y reporte sanitizado. Requiere autorización separada porque la excepción previa delimitó GET. Si se autoriza y responde con identidad válida, se actualizará el contrato antes del comprobador; si falla, se conserva la evidencia y se consulta al proveedor.

Evidencia completa en [verification.md](../verification.md). Seis GET totales en esta revisión, sin operaciones de pago ni mensajes.

## Contrato de identidad TextTorrent confirmado por POST

Tras la aprobación expresa del usuario se ejecutó una única petición POST sin cuerpo a `https://api.texttorrent.com/api/v1/user/auth/me`, solo con SID/public key y encabezados JSON. Respondió HTTP 200 con éxito e identidad válida. Se acredita autenticación de la administradora; no se acredita envío, subcuentas, líneas ni disponibilidad operativa. Cero mensajes, verificaciones pagas o cambios de configuración.

Esta es una excepción probada al contrato GET publicado y al comprobador genérico de GET, no un permiso de POST general o recurrente. El script genérico no se modificó en esta validación puntual. Una próxima actualización deberá permitir explícitamente solo ese POST de identidad y mantener bloqueados envío, acciones facturables, otras rutas POST y reintentos. La autorización de esta ejecución ya se consumió; no se repite sin nueva autorización o alcance recurrente acordado. Ver [evidencia](../verification.md).

## Dos buzones Composio validados después de corregir el segundo ID

La nueva comprobación, solicitada por el usuario, ejecutó solo tres GET Composio: configuración esperada y dos conexiones. Las tres devolvieron HTTP 200 y `ok`. Se comprobaron IDs/configuración, Gmail/OAuth2, estado habilitado/ACTIVE y ausencia de deshabilitación. Las identidades del proveedor estuvieron disponibles y fueron distintas: `distinctGmailMailboxesVerified=true`. Se conserva únicamente el resultado sanitizado, sin direcciones o valores privados.

No se ejecutaron herramientas Gmail ni solicitudes a los otros proveedores. Ambas cuentas son Playground y aún requieren asociación al modelo/usuarios del CRM. La comprobación de autenticación de los tres proveedores cuenta ya con evidencia positiva (Instantly y TextTorrent en las revisiones previas); las pruebas operativas de S00, permisos de acciones, subcuentas, entrega/latencia y recuperación permanecen pendientes. [Resultado completo](../verification.md).
