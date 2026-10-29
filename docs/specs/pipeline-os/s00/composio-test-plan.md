# S00: ensayo controlado de Composio

**Variante vigente:** [ejecutor API](composio-runner.md), con proxy Composio para Gmail REST, incluido el PDF y respuestas MIME. Los pasos por slug/S3 de abajo son la propuesta inicial, sustituida sin ampliar OAuth. El usuario amplió este run a 40 peticiones y autorizó sus PDF hasta 10 MB por archivo; se mantienen siete rondas por buzón. Cuota del plan Hobby revisada mediante capturas. Nueva clave revalidada; perfiles efectivos coincidentes y dos correos iniciales aceptados por Gmail. Se conservó token y contador (15 de 32 peticiones). La variante autorizada prescinde del ACK y del hash de fixture: los cuatro PDF fueron leídos en memoria y verificados por tamaño, firma PDF y SHA-256. Dos confirmaciones verificadas en sus hilos; 37/40 peticiones acumuladas (33 del ejecutor y cuatro diagnósticos previos).

Estado al 25 de octubre de 2026: **circuito funcional de dos buzones completado: dos iniciales, dos respuestas con cuatro PDF y dos confirmaciones de hilo**. Cubre S00-I-FR04/AC04 y prepara T00-03. Este documento no autoriza mensajes ni consumo facturable. No hay cambios en la app, worker, OAuth, triggers o Supabase.

## Lo comprobado y la decisión técnica

La configuración Gmail propia y los dos buzones distintos están ACTIVE según las lecturas previas. Los scopes configurados/solicitados son `userinfo.profile`, `userinfo.email`, `gmail.readonly` y `gmail.send`. No equivalen a permisos efectivos de ejecución demostrados. Las conexiones son de Playground; vincularlas al usuario y la marca del CRM corresponde a S02.

Las cinco definiciones de herramientas consultadas declaran versión `20261023_00`. El trigger `GMAIL_NEW_GMAIL_MESSAGE` declara polling y campos `interval`/`query`; no hay instancias activas en la configuración. No se creará un trigger para esta primera prueba. La lectura será dirigida por el ejecutor local futuro, limitada al identificador de ensayo y destinatario controlado.

**Hallazgo:** el contrato de `GMAIL_REPLY_TO_THREAD` en esa versión exige, además de lectura/envío de correo, uno de `contacts`, `contacts.other.readonly` o `contacts.readonly`. Ninguno está concedido en nuestra configuración. No se amplían permisos ni se prueba la herramienta para provocar un 403. Su adjunto exige `name`, `mimetype` y `s3key`; una ruta local no sustituye `s3key`, y no se ha autorizado subir archivos a Composio.

Alternativa preparada para responder: usar el proxy Composio hacia Gmail `users.messages.send`, con `connected_account_id` explícito, `user_id` propietario validado en memoria, `threadId` y MIME con Subject, In-Reply-To y References del mensaje ficticio. Esto mantiene la autenticación en Composio y usa `gmail.send`, sin pedir contactos. Es una propuesta sustentada en contratos, **todavía no una capacidad probada**: falta comprobar permiso Proxy execute de la clave y la respuesta real. Si no está disponible, parar y presentar la decisión antes de ampliar scopes o cambiar configuración. [Proxy oficial](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy), [permiso de proxy](https://docs.composio.dev/docs/extending-sessions/proxy-execute), [envío Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [requisitos de hilo](https://developers.google.com/workspace/gmail/api/guides/threads).

## Alcance revisable del primer ensayo

Supuesto reversible: buzones 1 y 2 ya configurados, un destinatario que controla el usuario y ningún lead real. Solo tras una autorización posterior del protocolo y de su consumo:

1. Validar privadamente identidad, propietario y permisos del buzón seleccionado. El destinatario sale de `S00_TEST_RECIPIENT_EMAIL`; debe ser válido, controlado y distinto de ambos remitentes. No imprimir estas direcciones ni IDs. No usar el teléfono.
2. Enviar **un mensaje de texto por buzón** usando `GMAIL_SEND_EMAIL`, versión fijada, `user_id: me` en sus argumentos Gmail y la conexión explícita en el sobre Composio. No confundir este `me` con el `user_id` de propietario requerido en el sobre/proxy. Sin firma automática, CC, BCC, destinatarios adicionales, adjuntos, enlaces o seguimiento.
3. El usuario responde **una vez a cada hilo**, desde el destinatario controlado, con el PDF ficticio preparado. Son dos respuestas manuales, sin mensajes automáticos adicionales.
4. Consultar cada buzón cada 30 segundos, hasta 10 rondas durante un máximo de cinco minutos. `GMAIL_FETCH_EMAILS` con query limitada al token único y remitente de prueba, `max_results: 5`, payload incluido y sin spam/papelera. Detener el polling del buzón al encontrar su respuesta exacta. Si el resultado es ambiguo o incompleto, no expandir la consulta al resto del buzón.
5. Obtener un adjunto por buzón mediante `GMAIL_GET_ATTACHMENT` con los IDs observados y nombre validado. Resolver el formato real de salida antes de descargar: no seguir URLs arbitrarias ni reenviar credenciales. Solo host HTTPS de descarga documentado de Composio, sin redirecciones; si no puede validarse, parar. Máximo 1 MiB, PDF y hash esperado. No ejecutar código contenido en adjuntos.
6. Solo si el permiso proxy quedó comprobado dentro de esta misma autorización futura: enviar una confirmación por hilo vía proxy, sin adjuntos, conservando el asunto y encabezados de respuesta. Verificar después que el mensaje está en el mismo hilo con una lectura por buzón. Si no, el resultado queda parcial; no generar un correo nuevo como sustituto silencioso.

Máximos: **4 mensajes de API** (2 iniciales + 2 confirmaciones), **2 respuestas manuales**, **32 operaciones Composio**. Distribución: 2 perfiles + 2 envíos + hasta 20 consultas + 2 adjuntos + 2 respuestas proxy + 2 lecturas finales = 30; reservar hasta 2 consultas dirigidas de conciliación o contrato, sin nuevos envíos. Las descargas HTTP de los dos adjuntos tienen presupuesto separado de **2 GET**, sin reintentos, timeout 8 s y máximo 1 MiB por respuesta. Ninguna llamada a Instantly, TextTorrent, Bouncer, compras, cambios de plan o configuración. El ejecutor futuro debe contar el presupuesto antes de cada petición y parar al agotarlo.

La documentación de Composio exige permiso de ejecución separado del acceso a metadatos. La cuota observada no acredita saldo, precio, gratuidad de ejecución ni derecho a activar el protocolo. Antes de ejecutarlo, confirmar consumo máximo aceptado y obtener autorización explícita; no asumir que usar una cuenta existente implica costo cero.

## Mensajes exactos

Token por buzón: `S00-COMPOSIO-<runToken>-M1` o `M2`. `runToken` se genera localmente al ejecutar, sin datos personales; no reutilizarlo después de una ejecución incierta.

Asunto inicial y de confirmación: `[S00 TEST] <token>`.

Texto inicial (inglés, sin HTML):

> Controlled integration test for Pipeline OS. No action on a real application is requested. Please reply in this same thread with: S00 ACK <token>, and attach the fictitious test PDF provided separately. Reference: S00-FIXTURE-001.

Respuesta manual esperada:

> S00 ACK <token>. Fictitious attachment for the controlled integration test.

Confirmación automática propuesta:

> S00 RECEIVED <token>. The fictitious attachment passed the integrity check. This controlled integration test is complete.

No se solicita documentación financiera real. El PDF de prueba no es la aplicación firmada del producto y no se envía a lenders.

## Fixture y aceptación

Adjunto local: [PDF ficticio](../../../../output/pdf/S00-composio-fixture.pdf), una página, 2.263 bytes, sin campos, enlaces, firmas ni archivos incrustados. SHA-256:

`57d85b15535c0ad501519b0d65537b9e05cda7fe2a6a89f6b5ef12b2820096bd`

| Criterio         | Resultado requerido                                                                     | Estado actual                                                               |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| C-M01 Selección  | Cada envío/lectura usa su conexión exacta y el destinatario autorizado.                 | Preparado; metadatos positivos, ejecución pendiente.                        |
| C-M02 Recepción  | Dos respuestas conciliadas por token, hilo y buzón; cero mensajes ajenos.               | Pendiente.                                                                  |
| C-M03 Adjunto    | Dos PDFs leídos con tamaño/hash idénticos al fixture.                                   | Fixture comprobado localmente; transporte pendiente.                        |
| C-M04 Hilo       | Confirmación visible en el mismo hilo; no requiere scope de contactos.                  | Contrato proxy preparado; permiso y comportamiento pendientes.              |
| C-M05 Duplicados | Reprocesar la misma respuesta dos veces produce un único registro/efecto local.         | Simulación offline preparada conceptualmente; no acreditar integración CRM. |
| C-M06 Latencia   | Medir llegada a buzón → detección local por separado del envío; objetivo inicial ≤60 s. | Sin mediciones reales. Dos muestras no certifican p95.                      |
| C-M07 Límites    | Respetar mensajes, llamadas, tamaño y parada ante resultado incierto.                   | Protocolo preparado; no hay ejecutor de envíos habilitado.                  |

El registro futuro será local, ignorado por Git: alias de buzón, token ficticio, timestamps UTC, estado, contador y hash de adjunto. IDs Gmail en memoria o registro privado para conciliación, nunca en reporte público. No almacenar cuerpos ni direcciones. Medir recepción en buzón (`internalDate`) → detección local, y detección → registro local. **No llamarlo recepción en CRM**: persistencia y visibilidad de la aplicación se medirán cuando exista S02/S03.

La prueba inicial tiene N=2. Un ensayo posterior de latencia requiere una muestra mayor, reportando N, p50/p95/máximo, ventana, cuota y costo con autorización específica; no extrapolar el percentil de dos mensajes. Revocación/reconexión, eventos reales y su replay también quedan fuera de esta autorización de lectura y del primer smoke test.

## Errores, parada y reversión

- 401/403/429, error de contrato o identidad: parar ese proveedor, sin elevar permisos ni reintentar. Timeout de envío o 5xx: estado incierto; no reenviar. Conciliar únicamente con el token y presupuesto restante; si persiste incertidumbre, intervención humana.
- Un destinatario o token inesperado, tamaño/hash incorrecto o URL de descarga no validada: parar. Releer un mensaje ya detectado no debe disparar otra confirmación; clave local de deduplicación por conexión + ID de mensaje y fase.
- Este paquete no añade un comando capaz de enviar. No hay procesos activos que detener, configuración remota que revertir ni claves nuevas. En un ensayo futuro, los mensajes enviados no son reversibles: por eso se autoriza antes el protocolo concreto y su presupuesto. La limpieza del buzón no se automatiza.

## Pendientes para T00-03

Autorizar y ejecutar el protocolo, confirmar permisos tool/proxy y consumo; verificar resultados reales; ampliar medición si hace falta; probar revocación/reconexión en cuenta controlada con autorización. Completar contrato del trigger/recepción e idempotencia antes de activarlo en el CRM. Este plan preparado no cierra S00 ni acredita integración productiva.

## Inicio de prueba guiada solicitado por el usuario

Tras verificar los objetos de 030, el usuario pidió continuar con envío, respuesta y adjunto en los dos buzones y recibir guía paso a paso. Esta es autorización de la prueba controlada, sin volver a pedir aprobación general de los envíos. Se mantienen los límites del protocolo y la restricción de no comprar servicios, cambiar planes o generar cargos adicionales no autorizados; la cuota disponible debe comprobarse antes de ejecutar. Se reutilizan conexiones/destinatario ya configurados; no se solicitan otra vez sus claves. Se empieza por un buzón y se repite con el otro. El primer paso guiado identifica la pantalla del proyecto Composio y su configuración Gmail, para no inventar controles de una interfaz no observada. La prueba no ha comenzado: cero mensajes, acciones Gmail, lecturas de conversaciones o nuevas llamadas autenticadas en esta continuación. No se implementa todavía el adaptador de S02 ni se habilita worker.
