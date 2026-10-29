# S00: ejecutor API de ensayo Composio

Nivel STRICT, limitado a dos buzones propios y un destinatario controlado. El usuario autorizó ejecutar la prueba por API con las credenciales guardadas, sin nuevas compras/cargos o cambios de planes. La carga interna de `s00.env` está autorizada; `.env.local` no se usa. El navegador no se utiliza.

## Requisitos y aceptación

| Requisito                         | Criterio verificable                                                                                                                                                                                                                                 | Tarea        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S00-R-FR01 Selección y privacidad | Preparar verifica configuración esperada y dos conexiones Gmail ACTIVE, distintas, con propietario e identidades; perfiles efectivos deben coincidir antes de enviar. Destinatario válido y diferente. Solo reportes de alias/estados/contadores.    | S00-R-T01    |
| S00-R-FR02 Envío acotado          | Hasta cuatro correos API, dos iniciales y dos confirmaciones, sin CC/BCC; reserva persistida antes de cada tentativa, sin reintentos. Doble invocación/crash no reenvía.                                                                             | S00-R-T02    |
| S00-R-FR03 Recepción y PDF        | Consultar solo los hilos creados por el ensayo, validar remitente/token/subject/hilo; hasta siete consultas por buzón. PDF de nombre/tamaño/hash esperados, lectura vía proxy, sin descargas URL arbitrarias.                                        | S00-R-T03    |
| S00-R-FR04 Uso y límites          | Consultar uso antes/después; no confundir rate limit, consumo y cupo mensual. No ejecutar proxy hasta confirmar que hay al menos 32 llamadas estándar incluidas disponibles. Máximo 32 peticiones del ejecutor, sin compras/Instant ni plan changes. | S00-R-T01–03 |
| S00-R-FR05 Seguridad de ejecución | Modo offline por defecto; CLI con acciones explícitas y bloqueo exclusivo del journal; rutas fijas, TLS, sin redirects, timeout 8 s, cuerpos acotados y errores públicos fijos. Tests negativos/fallos/replay.                                       | S00-R-T04    |

## Diseño y decisión de transporte

Se cambia el transporte previsto en el plan inicial a **proxy Composio para todas las acciones Gmail**. Justificación: Gmail `gmail.readonly`/`gmail.send` permiten lectura, mensajes MIME con threadId y adjuntos base64; evita el scope de contactos de GMAIL_REPLY_TO_THREAD y el contrato S3 de GET_ATTACHMENT. No cambia las reglas de correo de la app ni implementa S02. El proxy inyecta credenciales Google en servidor; nunca se extraen tokens.

Composio: `POST /api/v3.1/tools/execute/proxy`, `connected_account_id` y propietario explícitos, `endpoint` fijo bajo `https://gmail.googleapis.com/gmail/v1/users/me/`, método GET/POST y body JSON. Gmail: profile; messages/send; threads/{ID}; messages/{ID}/attachments/{ID}. Lecturas limitadas al hilo e IDs del ensayo, no inbox general. MIME base64url, Subject conservado, In-Reply-To y References validados. Las herramientas definidas por slug/version no se ejecutan en esta variante; Gmail REST v1 es el contrato utilizado.

Fuentes: [proxy](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy), [Gmail send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [hilos](https://developers.google.com/workspace/gmail/api/guides/threads), [adjuntos](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get), [uso de proyecto](https://docs.composio.dev/reference/api-reference/projects/postProjectUsageSummary).

Uso: la lectura real inicial dio HTTP 200, `instant_charge=0` y rate limit 2000, pero **no expone cupo mensual restante**. No se infiere saldo o coste cero de esa respuesta. Se pidió solo confirmar disponibilidad de 32 llamadas estándar incluidas; no claves, nueva autorización de envío ni datos de pago. Esas cuatro peticiones iniciales de diagnóstico quedan separadas del contador del ejecutor. No se vuelve a usar el navegador que se detuvo en la ronda anterior.

## Estado, fallos y reanudación

Journal ignorado `.local/pipeline-os/s00-composio-run.json`: token ficticio, huella de configuración, propietarios/IDs privados para continuar y estados/counters; sin claves, correos o cuerpos de correo. Escritura atómica y lock exclusivo antes de abrirlo; no se roba un lock dejado por crash. Un envío pasa a in_flight y se persiste antes de llamar; cualquier outcome incierto impide repetirlo. Un error de permisos/rate limit/contrato detiene la ejecución. El informe público nunca vuelca journal, exception.message o respuesta del proveedor.

Acciones: status (offline), prepare (metadatos/uso), send (perfiles y dos correos iniciales una vez), inspect (una ronda, adjunto si hay respuesta), confirm (máximo una confirmación por buzón), usage (lectura final). El caller debe confirmar disponibilidad de llamadas incluidas antes de la primera operación proxy. No hay cron o worker; el usuario indica cuándo respondió, sin polling continuo antes de que tenga oportunidad de hacerlo. Cada invocación inspect consume hasta una ronda y el límite acumulado es siete por buzón.

Aceptación de fase inicial: comprobar cuota disponible, conexiones/perfiles y dos envíos aceptados por Gmail. Aceptación de respuestas depende de las dos respuestas humanas con PDF; no se marca terminada por envío exitoso. El smoke N=2 no certifica p95 ni recepción en CRM. La revocación/reconexión, triggers reales y adaptación de la aplicación siguen fuera de este ejecutor.

Rollback: detener invocaciones. No revertir ni borrar correos; no hay cambios remotos de configuración. Los mensajes enviados son irreversibles; conciliar resultado incierto antes de plantear otro ensayo. No iniciar otro run para eludir una reserva incierta.

## Verificación prevista

Fixtures de contratos reales anonimizados: offline, scopes/identidad, destino inválido, cabeceras aisladas, HTTP/proxy errors, lectura limitada, payloads enormes, MIME/RFC headers, presupuestos, persistencia fallida, replay y timeout incierto. CLI probado sin carga implícita de archivos y journal/lock locales. TypeScript directo y regresión S00 relevante, sin build que cargue `.env.local`.

## Uso del CLI

Desde la raíz, offline: `node --import tsx scripts/pipeline-os/s00-composio-runner-cli.ts`. Con Node portátil y carga interna autorizada de s00.env, `--action prepare --execute` comprueba metadatos/uso sin Gmail. `--action send --execute --included-calls-confirmed` corresponde solo después de obtener información real de llamadas incluidas: el flag no reemplaza verificarla. Después, inspect cuando el usuario respondió, confirm tras hash correcto y usage al terminar. Las acciones siempre son explícitas y no se activa un worker.

Estado real: preparado, cuatro llamadas del runner, ningún perfil/proxy/envío ejecutado. Otras cuatro lecturas de diagnóstico registradas por separado. Tests nuevos 14/14; S00 52/52 y TypeScript correctos. Mensajes exactos en composio-test-plan.md; aceptación operativa pendiente.

## Incidencia real y recuperación acotada de permisos

Las capturas del usuario muestran Hobby (100.000 llamadas incluidas/mes) y uso de organización cero en los últimos siete días; no se presenta esa ventana como un contador mensual completo. Se habilita la prueba acotada sin upgrades/Instant/compras. La primera consulta de perfil por proxy devuelve HTTP 403, antes de los dos envíos. Una única reproducción diagnóstica de la misma lectura, contabilizada dentro del run, identifica las categorías permission/scope y proxy-execute, sin host/domain/ownership/API-disabled. Ambos initial siguen not_sent, profilesVerified=false, fase blocked, calls=6. No se vuelve a enviar o ejecutar proxy hasta resolver el permiso.

La [referencia de permisos](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions) distingue Proxy execute (Legacy), Write only, de Tools Read only y del acceso a cuentas. Los scopes de una clave no se editan después de crearla. Se propone una clave del mismo proyecto con Auth configs Read only, Connected accounts Read only, Observability Read only y Proxy execute (Legacy) Write only; el resto No access. No se requieren nuevos scopes Google. El usuario realiza la creación/cambio en la configuración privada; el agente no amplía permisos o genera credenciales por su cuenta.

Requisito de recuperación S00-R-FR06: permitir revalidación prepare únicamente cuando el error previo es HTTP_403, no hubo ningún intento de envío, no se verificaron perfiles y no hay respuestas/polls. La nueva clave debe conservar exactamente auth config, dos cuentas y destinatario, comprobados mediante huella separada de destino. Mantener token y contador acumulado. La fase vuelve a prepared solo después de revalidar metadatos/uso; los perfiles se comprueban otra vez antes de enviar. Un envío in_flight/sent/uncertain/failed o un destino diferente impide esta recuperación. Proteger con tests de rotación, cambio de destinatario y resultado incierto. El journal v1 anterior se vincula al destino solo si su huella completa coincide todavía con la configuración original y sin cambiar estados/contador; no se reescribe a partir de una clave nueva sin esa comprobación.

## Reanudación real correcta: esperando respuestas

Nueva clave guardada por el usuario. prepare revalidó el destino original y cuentas, sin reset: 6→10 llamadas. send validó dos perfiles coincidentes y Gmail aceptó un correo inicial por buzón: 10→14. Consulta de uso posterior: 15/32 llamadas; instantCharge=0, eventCount=null (no acredita cupo restante o cobro global cero). Ambos initial=sent, sin confirmaciones o respuestas detectadas todavía. Token del mismo run conservado. Se espera que el usuario responda en ambos hilos con S00 ACK y PDF ficticio antes de inspect. No repetir send; las reservas previenen duplicados.

## Dos respuestas recibidas, pendientes de alcance de adjuntos

El usuario respondió ambos hilos. Hay una respuesta del destinatario esperado en cada hilo, pero falta ACK y cada una trae dos PDF distintos del fixture; varios son mayores de 1 MiB. Se detectó por metadatos, sin descargar esos archivos. No es solo un problema de HTML: el texto obtenido con los helpers existentes tampoco contiene el ACK. Se conservan 20/32 llamadas, initial=sent y confirmation=not_sent, sin resets o reenvíos.

ACK es una marca artificial de este ensayo para asociar una respuesta al protocolo; no es requisito funcional del producto. La app debe correlacionar por cuenta, hilo, mensaje y remitente. Se espera decisión sobre continuar con fixture, adaptar la prueba a los otros PDF con tamaño/presupuesto explícitos o dejar validación parcial. No se cambia silenciosamente el protocolo ni se declara hash de origen verificado de un archivo sin referencia. Prueba negativa de entrada distinta correcta, suite de ejecutor 17/17 y TypeScript correcto.

## Cambio autorizado S00-R-FR07: PDF enviados por el usuario

El usuario decidió continuar con los PDF ya enviados, autorizó leerlos sin analizar su contenido y fijó hasta **10 MB por archivo y 40 peticiones acumuladas**. Se interpreta MB decimal: 10.000.000 bytes. Esta decisión sustituye ACK/fixture solo para este run y estos dos hilos; no autoriza acceder a otros correos, analizar documentos, modificar scopes o reenviar iniciales.

Diseño previo al código: política explícita y persistida `provided_pdfs_10mb`, activada solo por acción inspect con flag de autorización correspondiente. La transición exige mismo fingerprint/destino, perfiles verificados, dos iniciales sent, confirmaciones not_sent y ninguna respuesta ya procesada; únicamente desde prepared o el bloqueo ACK_TOKEN_MISSING. No se reinician token, contador (actualmente 20), rondas o reservas. Fallos de remitente/hilo/configuración y envíos inciertos no admiten este camino.

Criterios S00-R-AC07:

- Cada hilo mantiene cuenta, ID original, asunto y remitente/destinatario exactos. En esta política no se lee/decodifica texto del cuerpo ni se exige ACK. Respuestas múltiples ambiguas siguen bloqueadas.
- Procesar todos los PDF adjuntos de cada respuesta, máximo dos por hilo (cuatro totales observados), 10.000.000 bytes cada uno. Validar metadatos/tamaño antes de descargar; solo endpoint Gmail de esos IDs por proxy, sin URLs externas. Respuesta HTTP de adjunto limitada a 14.000.000 bytes para transportar su base64; los demás endpoints conservan su límite actual. Decodificación también acotada.
- Comprobar longitud recibida frente al tamaño MIME/API, firma inicial `%PDF-` y SHA-256. Registrar solo longitud/huella en journal privado; descartar bytes en memoria. No escribir PDF, nombres privados, cuerpos o texto a disco; no parser, render, OCR, IA, enlaces embebidos o análisis financiero.
- Informe distingue `bytes_size_signature_sha256` de comparación con hash de fixture. Sin hash de origen, `sourceHashCompared=false`; no afirmar integridad contra original ni validez estructural completa del PDF.
- Máximo 40 solicitudes desde el inicio del run, sin reset; hasta cuatro mensajes API totales. Confirmaciones describen recepción y checks de bytes/firma/huella, sin afirmar revisión de contenido o coincidencia de hash con origen. La demora observada incluye espera humana y depuración: no certifica SLA/p95/polling del CRM.

Tarea S00-R-T05: implementar política/validación/lectura acotada y confirmación veraz; probar transición segura, límites, tipo/tamaño, varias adjuntos, no ACK, privacidad y replay; ejecutar sobre el mismo run y registrar recepción de los cuatro PDF, dos confirmaciones y uso final. Se conserva la política de fixture de 32 llamadas sin ese flag. Rollback local: volver al código anterior manteniendo journal y mensajes; no borrar documentos o reiniciar reservas. No hay cambios de aplicación, base, worker ni permisos remotos.

## Resultado real de la variante autorizada

Ejecutor/test/CLI adaptados y verificados: 60/60 pruebas S00 y TypeScript correctos. Mismo run, contador inicial 20: dos hilos y cuatro PDF leídos con límites →26; dos confirmaciones enviadas y verificadas en sus hilos →32; uso final →33 internas; total consolidado 37/40 al incluir los cuatro diagnósticos previos. Cuatro mensajes API totales (dos iniciales, dos confirmaciones), dos respuestas humanas y cuatro PDF. Cada archivo cumple tamaño/firma; SHA-256 computado, sin comparación de hash de origen o análisis de contenido. Ningún PDF se escribió a disco. Repetir inspect/confirm sobre estado final no intenta red o escritura, ni duplica mensajes.

instantCharge final 0 es el dato de Instant reportado; no una auditoría global de costes o un contador de cupo. Latencias observadas incluyen espera y depuración manual, no certifican SLA/p95. El circuito funcional de este ejecutor está completado; integración, recepción automática y reconexión del CRM siguen pendientes.

### Contabilidad acumulada completa

Al consolidar la evidencia se incluyen también las cuatro consultas iniciales de diagnóstico anteriores a crear el journal (ya documentadas aparte). El total del ensayo es **37 peticiones: 33 del ejecutor + 4 previas**, dentro del límite de 40. No se reinicia o incrementa ficticiamente el contador interno: persistir `priorDiagnosticCalls=4` respaldado por el reporte sanitizado inicial; el informe expone ambos componentes y el total, y el límite interno deja solo tres solicitudes de red disponibles. Validar ese campo como entero de 0 a 4 y restarlo al presupuesto, también al cargar el journal. Proteger con test de agotamiento: 36 internas + 4 previas bloquean la siguiente petición. Esta corrección es contabilidad local, no otra operación de proveedor.
