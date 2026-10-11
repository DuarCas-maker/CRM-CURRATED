# Gmail histórico: implementación y activación

## Lo encontrado y lo implementado

El proyecto ya tenía OAuth con estado de un solo uso, MFA, refresh tokens cifrados, Gmail send/read, Pub/Sub, permisos de remitentes, una cola persistente, Storage privado y validación Bouncer. Su sincronización inicial buscaba aproximadamente desde la conexión de la cuenta, descartaba contactos desconocidos y no ofrecía análisis anual ni confirmación comercial. La actualización aprovecha esas piezas y añade las migraciones 009–015.

| Área                | Resultado de esta etapa                                                                                                    | Límite o validación pendiente                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conexión            | OAuth por organización; autorizar no habilita incorporación comercial ni reactiva envíos pausados                          | Configurar Google Cloud y probar una cuenta real                                                                                                                  |
| Análisis anual      | Recibidos, enviados y archivados, sin spam, papelera ni borradores; progreso y candidatos paginados                        | Gmail ofrece una estimación inicial; el total final se obtiene al recorrer mensajes                                                                               |
| Vista previa        | Fechas, participantes directos y en copia, coincidencias exactas, posibles duplicados, documentos y actividad mensual      | Participantes candidatos no equivalen a empresas ni clientes confirmados; no hay OCR ni extracción semántica                                                      |
| Importación         | Selección y clasificación explícita; empresas/contactos compartidos y oportunidad principal; pausa, reanudación y deshacer | No se unen empresas por nombres parecidos; varios casos existentes requieren elegir uno                                                                           |
| Excepción histórica | Conversaciones y destinatarios de campañas pueden incorporarse sin Bouncer                                                 | No marca el correo como validado ni elimina los requisitos de envío de campañas nuevas                                                                            |
| Sincronización      | `history.list`, checkpoints persistentes, recuperación del año si expira el cursor, polling y Pub/Sub                      | Una dirección exacta con un caso inequívoco o un hilo confirmado se asocia; los demás requieren revisión                                                          |
| Lenders             | Asociación explícita a una evaluación existente, selección de oferta y descarte de alternativas                            | Reconstruir automáticamente evaluaciones, ofertas y relaciones por empresa queda para la etapa semántica; no hay generación automática de evaluaciones históricas |
| Procesos            | Archivo pendiente de separar y procesos confirmados distintos, con fechas, estados y reasignación manual de hilos          | El archivo sin clasificar no aumenta el contador de procesos confirmados                                                                                          |
| Seguimiento         | Cinco días calendario, tareas por responsable y borradores editables para revisar                                          | La naturaleza del mensaje se deduce de cabeceras técnicas; campañas sin esas cabeceras requieren revisión humana y mejoras semánticas                             |
| Documentos          | Copia cifrada de adjuntos recientes y documentos antiguos reconocibles por nombre en casos activos; referencias restantes  | La relevancia de documentos antiguos se determina por nombre, no por su contenido. Límite 20 MiB por archivo y 18 MiB agregados antes de codificar el correo      |
| Expediente          | Contactos, correos, documentos, timeline paginada y conteo de mensajes enviados por naturaleza                             | Incorporar un adjunto no aprueba el checklist financiero ni interpreta estados bancarios                                                                          |
| Respuestas          | Cuenta principal seleccionable, permiso de remitente y adjuntos previamente aprobados                                      | Solo se envía por acción explícita; probar respuesta real, threading y adjuntos en el piloto                                                                      |
| Traspasos           | Auditoría de responsable anterior/nuevo y cuenta; bloqueo de reasignación automática posterior                             | Conceder permiso de envío al nuevo responsable por separado                                                                                                       |
| Riesgo / IA         | Puntos de evidencia y estados separados preparados para revisión                                                           | Sin proveedor, presupuesto, OCR, NYSCEF ni llamadas de IA. No hay underwriting automático                                                                         |

Las cuentas de diferentes organizaciones pertenecen al mismo equipo comercial. No hay separación entre empresas por tenant de Google: se mantienen los permisos comerciales actuales, MFA y RLS. Tener acceso a un remitente no concede acceso a expedientes ajenos ni a negociaciones privadas.

## Decisiones aceptadas

- **Deshacer:** archiva solo casos creados por la importación que no tengan trabajo posterior. Retiene casos existentes, traspasos, notas, análisis, documentos revisados, envíos y otros cambios manuales. Conserva correos, archivos copiados, contactos y auditoría. No restaura campos de casos existentes ni borra objetos de Storage. La sincronización de otros casos de la cuenta continúa; los archivados no se vuelven a abrir automáticamente.
- **Seguimientos:** cinco días calendario desde el último mensaje personal del participante esperado. Campañas, respuestas automáticas y reportes de entrega no reinician la espera. Se distinguen equipo, cliente y lender. Los borradores son plantillas de seguimiento, no respuestas generadas por IA.
- **Responsable inicial:** última interacción personal identificada, excluyendo cabeceras reconocidas de campañas/rebotes/autorespuestas. Campañas sin señales técnicas no se pueden clasificar con certeza: revisar la asignación. Una decisión manual posterior prevalece.
- **Importación histórica:** requiere aprobación administrativa y no ejecuta verificaciones pagadas. Los leads nuevos mantienen preparación → validación → oportunidad Nuevo.

La sincronización detiene una secuencia de campaña al recibir una respuesta personal de su destinatario exacto, únicamente si esa campaña ya había enviado un mensaje antes de la respuesta. Un mensaje antiguo recuperado no cancela campañas posteriores. Los reportes de entrega se distinguen de los rechazos financieros; la atribución automática de rebotes a una dirección y su supresión queda pendiente del análisis de reportes DSN. No se cierra la empresa por un rebote.

## Activar en la instalación existente

1. Hacer respaldo de Supabase y conservar la clave actual `INTEGRATION_ENCRYPTION_KEY`. No regenerarla.
2. En SQL Editor, rol `postgres`, ejecutar **todo** `supabase/install/gmail-history.sql`. Es una actualización atómica desde 001–008. No ejecutar además los archivos 009–015: sería aplicar lo mismo dos veces. Si alguna migración 009 o posterior ya está instalada, revisar el estado y aplicar únicamente las pendientes individualmente, en orden.
3. Publicar el código en web y `curated-worker`. Puede desplegarse antes de la actualización porque `GMAIL_HISTORY_ENABLED` está desactivada por defecto.
4. Configurar `GMAIL_HISTORY_ENABLED=true` en **Production / Runtime** de ambos recursos, después de instalar SQL. Guardar y desplegar ambos. No cambiar `NEXT_PUBLIC_*` ni configurar esta bandera en Build.
5. Mantener `APP_ORIGIN=https://crm.finlabinc.com`, URL/clave de servicio Supabase y clave de cifrado iguales en web y trabajador. Conservar `BOUNCER_API_KEY`; Gmail no la utiliza.
6. Configurar las variables de Google del apartado siguiente. Guardar y desplegar web y trabajador. El worker usa `/Dockerfile.worker`, sin dominio, y su healthcheck de latido. La web mantiene `/Dockerfile`, puerto 3000 y `/api/health`.
7. Ingresar como superadmin con MFA y abrir **Configuración → Importación histórica de Gmail**. Conectar la primera cuenta, asignar su responsable y conceder permisos de remitente desde Administración de accesos.
8. Pulsar **Analizar un año**. Todavía no se crean contactos ni oportunidades. Revisar fechas, mensajes, documentos, actividad mensual y coincidencias. Medir tiempo y volumen real antes de prometer 10–20 minutos.
9. Revisar y seleccionar una muestra pequeña de candidatos. Elegir cliente/lender/intermediario, empresa, estado activo/inactivo y asociación existente cuando corresponda. Los participantes solo en copia requieren un expediente explícito. Un lender necesita una evaluación concreta; si no existe, dejarlo pendiente para reconstrucción manual/semántica.
10. Pulsar **Confirmar importación**. Abrir la oportunidad y la pestaña **Correo e histórico**. Separar los procesos confirmados y mover los hilos correspondientes. No llamar al conjunto anual un único proceso real.
11. Tras completar la importación queda habilitada la sincronización de esa cuenta. Mensajes nuevos sin asociación fiable quedan en análisis de «Mensajes nuevos» para revisión administrativa.

## Google Cloud / Workspace

Para organizaciones distintas, usar una aplicación OAuth interna configurada por cada organización, o una aplicación externa cuya verificación y acceso hayan sido aprobados. El código comprueba el dominio Workspace (`hd`) contra la organización elegida. Una app interna de una organización no concede acceso a usuarios de otra.

La instalación puede funcionar con OAuth y consultas periódicas sin Pub/Sub. Este modo evita la necesidad de conceder acceso al servicio externo de notificaciones de Gmail; no evita restricciones de autorización OAuth impuestas por Workspace.

1. Crear o seleccionar el proyecto de Google Cloud de esa organización y habilitar Gmail API. Pub/Sub API solo es necesaria para el modo `pubsub`.
2. Configurar Google Auth Platform: branding, audiencia interna cuando corresponda y datos de contacto.
3. Registrar un cliente OAuth de tipo **Web application**. URI de redirección exacta: `https://crm.finlabinc.com/api/gmail/callback`.
4. Solicitar `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly` y `https://www.googleapis.com/auth/gmail.send`. No solicitar Contacts ni contraseñas de Gmail.
5. En Coolify, configurar `GMAIL_SYNC_MODE=polling` en **Production / Runtime** de la web y de `curated-worker`. Mantener `GMAIL_HISTORY_ENABLED=true` y `APP_ORIGIN=https://crm.finlabinc.com` en ambos.
6. Registrar la organización en `GOOGLE_OAUTH_ORGANIZATIONS` de web y trabajador. Guardar los secretos directamente en Coolify. No pegarlos en chats, archivos versionados ni capturas. No activar Build para el JSON, el modo ni las credenciales de Google.
7. Guardar y desplegar los dos recursos, de uno en uno en el VPS. Entrar al CRM con superadmin/MFA y seguir los pasos de análisis, revisión y confirmación anteriores. No repetir las migraciones 009–015 si ya están aplicadas.

```json
[
  {
    "id": "curated",
    "domain": "curatedfinancial.com",
    "clientId": "CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "REEMPLAZAR_EN_COOLIFY"
  }
]
```

En modo `polling` no se configura Pub/Sub: omitir `pubsubTopic` del JSON y no añadir `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE` ni `GOOGLE_PUBSUB_SERVICE_ACCOUNT`. Si esas variables ya existen, el modo las ignora. El worker programa consultas aproximadamente cada minuto para las cuentas con importación confirmada y mantiene cursores, deduplicación, reintentos y revisión de mensajes nuevos. El intervalo real depende de la cola y de Gmail; no es una garantía de actualización inmediata.

Para habilitar Pub/Sub posteriormente:

1. Crear el topic en **el mismo proyecto que el cliente OAuth**, por ejemplo `projects/PROJECT_ID/topics/gmail-events`. Dar `Pub/Sub Publisher` en ese topic a `gmail-api-push@system.gserviceaccount.com`; resolver la política de dominios con el administrador cuando corresponda.
2. Crear una cuenta de servicio y una suscripción push autenticada al topic con destino `https://crm.finlabinc.com/api/gmail/push`, usando esa URL como audience. Mantener desactivada la eliminación de la envoltura del mensaje (payload unwrapping).
3. Añadir `pubsubTopic` a la organización en el JSON de ambos recursos. En la web configurar `GOOGLE_PUBSUB_AUDIENCE=https://crm.finlabinc.com/api/gmail/push` y `GOOGLE_PUBSUB_SERVICE_ACCOUNT=CUENTA@PROJECT_ID.iam.gserviceaccount.com`.
4. Cambiar `GMAIL_SYNC_MODE=pubsub` en ambos y desplegar. La identidad push común requiere permisos adecuados cuando se use en suscripciones de diferentes proyectos.

El worker renueva el watch próximo a expirar solo en modo `pubsub`; en ambos modos mantiene reconciliación periódica. El checkpoint de importación no se reemplaza por el devuelto al renovar watch. Un cursor expirado provoca una conciliación del año admitido, conservando los datos ya importados. Consulte [sincronización Gmail](https://developers.google.com/workspace/gmail/api/guides/sync), [notificaciones push](https://developers.google.com/workspace/gmail/api/guides/push) y [suscripciones push autenticadas](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

`gmail.readonly` es un scope restringido. El procedimiento de verificación y una posible evaluación de seguridad dependen de la audiencia, de las excepciones aplicables y del uso de datos en servidor. Validar el caso de cada organización con su administrador antes del piloto. Referencias: [scopes Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) y [verificación de scopes restringidos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## Piloto y recuperación

Si «Autorizar con Google» no cambia la página en Chrome, revisar el error `form-action` en la consola. La política de la web debe permitir `form-action 'self' https://accounts.google.com` para la redirección del formulario OAuth; no requiere habilitar popups. El ajuste está en `next.config.ts` y requiere compilar y desplegar **la web**. Después recargar la página antes de reintentar. Los errores mostrados ya dentro de Google corresponden a la configuración OAuth y deben revisarse por separado.

Usar mensajes de prueba controlados; no enviar a clientes reales durante la aceptación. Probar:

1. Analizar una cuenta; confirmar que no aparecen oportunidades ni consumos Bouncer antes de aprobar.
2. Importar pocos contactos, incluyendo un destinatario de campaña sin respuesta y un participante solo en copia. Verificar que la copia no se convierte por sí sola en cliente principal.
3. Pausar durante lectura o incorporación, reiniciar worker y reanudar. Probar reanálisis y la misma cuenta reconectada: no duplicar mensajes ni procesos.
4. Enviar desde Gmail directamente y recibir una respuesta en el hilo. Verificar el expediente, la naturaleza del correo y la espera correspondiente. Probar un hilo nuevo del mismo contacto y uno ambiguo.
5. Descargar un adjunto copiado y una referencia antigua. Desconectar y confirmar que los copiados y los textos importados siguen disponibles. Las referencias remotas dependen de Gmail y de la autorización vigente.
6. Revisar/aprobar un archivo y responder explícitamente desde el CRM con una muestra de adjuntos. Verificar Gmail y la copia enviada. No activar campañas masivas con esta prueba.
7. Traspasar responsable/cuenta. Incorporar un mensaje posterior desde la cuenta anterior y comprobar que no cambia el responsable.
8. Seleccionar una oferta entre dos lenders y comprobar que se distingue «descartada por otra oferta» de «rechazada». No debe registrar firma, aprobación final o desembolso.
9. Deshacer un caso sin cambios y otro con trabajo manual. El primero sale del flujo; el segundo y todo el historial permanecen.
10. Verificar un vendedor ajeno y un vendedor con acceso al mismo remitente: ninguno debe acceder al expediente sin permiso comercial. Tras el traspaso, las negociaciones de closer deben seguir privadas.

Ante `GMAIL_HTTP_401`, reautorizar la cuenta y reanudar el análisis; no reactivar envíos inciertos. Ante cuota/429, conservar el cursor y esperar el reintento persistido. `GMAIL_ASSOCIATION_REVIEW` requiere revisar empresa, proceso y evaluación del candidato antes de reanudar. Los archivos que exceden el límite quedan como referencia con error visible.

Un `GMAIL_HTTP_403` sin motivo no permite distinguir cuota de permisos. Ahora el análisis conserva un código conocido de Google, por ejemplo `GMAIL_HTTP_403_userRateLimitExceeded`, y muestra su explicación junto con la fecha del reintento. El error desaparece cuando vuelve a persistirse progreso. Las cuotas mantienen el análisis activo y respetan `Retry-After` (segundos o fecha HTTP); una restricción de Workspace o de autorización pausa el análisis y requiere resolver el acceso. Los logs del worker incluyen el código y la espera, sin texto crudo de Google, correos ni tokens.

Si el contador continúa aumentando, mantener el mismo análisis: no desconectar ni iniciar otro. Para instalar la corrección, desplegar web y trabajador por separado, desde el mismo commit. No hay migraciones ni variables nuevas; los mensajes y el cursor ya guardados se conservan. Si el análisis está pausado, resolver el motivo indicado y reanudarlo.

Los logs `kind=gmail_archive,result=completed` corresponden a trabajos pequeños de la cola, no al análisis anual completo. Ante límites repetidos, el contador de fallos consecutivos se reinicia únicamente después de un bloque de análisis exitoso; un bloque con progreso parcial y error conserva la racha. Esto evita heredar esperas de una hora por errores antiguos ya recuperados. El `retry_at` existente se respeta al desplegar, al igual que cualquier `Retry-After` de Google; no se fuerza una consulta antes de ese plazo.

Cada rechazo por cuota reduce a la mitad el presupuesto de consultas de esa cuenta, hasta un mínimo de 600 unidades/minuto. La reducción se mantiene durante la vida del proceso y no afecta las demás cuentas; un reinicio vuelve al presupuesto inicial de 4.500. No sustituye coordinación entre varios workers o clientes que usen el mismo buzón. Los errores de análisis registran `operation` (solo método, sin IDs ni consultas), `provider_retry_seconds`, `retry_source`, `failure_streak` y `units_per_minute`. Así se distingue la espera indicada por Google de la calculada por el CRM, sin registrar cuerpos de correo, credenciales ni texto crudo de la API. El despliegue de esta corrección requiere actualizar el worker; actualizar también la web mantiene la misma versión del cliente Gmail compartido. No necesita SQL ni variables nuevas.

`Failed to fetch` en la parte superior del panel es un fallo al consultar el estado desde el navegador, independiente del error de Gmail que figura dentro del análisis. La pantalla conserva los últimos datos, espera a que termine cada consulta antes de programar otra y reintenta automáticamente; «Actualizar estado» solo repite una consulta GET. El aviso desaparece cuando llega una respuesta válida. Una sesión vencida solicita volver a iniciar sesión en el CRM sin desconectar Gmail. La causa original de un fallo de red requiere los datos de esa petición del navegador/proxy; una comprobación pública de salud no valida el análisis autenticado.

El panel recuerda el análisis elegido durante la sesión de la pestaña, por usuario del CRM. Si todavía no hay una selección guardada válida, elige un histórico activo. Si tras recargar falta el contador, seleccionar el histórico en «Análisis e importaciones»; eso no inicia otro análisis. La corrección de actualización y selección del panel se despliega únicamente en la web, sin modificar worker, variables ni migraciones.

## Escala, tiempo y presupuesto de IA

El panel muestra `estimated_messages` como total aproximado de Gmail, los mensajes guardados, los omitidos y los restantes estimados. El avance de lectura incluye guardados y omitidos; la estimación no equivale a una selección de expedientes ni a una garantía de duración. Gmail define `resultSizeEstimate` como [una estimación del total de resultados](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

Si la estimación falta o ya fue alcanzada/superada mientras quedan páginas, los restantes aparecen como «Por determinar» y la barra queda indeterminada: nunca se muestra 100 % por alcanzar una estimación. Al terminar la lectura se muestra el total guardado definitivo y cero pendientes de analizar. La incorporación comercial todavía requiere confirmar candidatos. Este indicador utiliza los datos persistidos existentes y no agrega llamadas a Gmail, SQL ni variables; se despliega únicamente en la web.

Los trabajos procesan bloques acotados y hasta tres lecturas paralelas, con progreso persistido y reintentos por cuenta. Esto permite configurar 15–20 cuentas; **no se ha validado todavía esa carga con Google ni el VPS de 6 GB**. Medir cantidad de mensajes/adjuntos, duración, RAM del worker, latencia SQL y errores de cuota con una cuenta, luego dos y después más. No ejecutar el build de web y trabajador simultáneamente en ese VPS. Referencia: [cuotas Gmail](https://developers.google.com/workspace/gmail/api/reference/quota).

Para proyectos nuevos desde el 1 de mayo de 2026, Google documenta 6.000 unidades por usuario/proyecto/minuto y 20 unidades por lectura `messages.get`; la cuota efectiva del proyecto debe comprobarse en Google Cloud. El cliente distribuye las llamadas con un presupuesto conservador de 4.500 unidades por cuenta/minuto **por proceso**, incluyendo lecturas y adjuntos. Otros procesos o clientes de la misma cuenta siguen compartiendo límites de Google: el ajuste reduce ráfagas, pero no garantiza ausencia de cuotas ni un tiempo de finalización. Referencias: [cuotas y costes por método](https://developers.google.com/workspace/gmail/api/reference/quota) y [motivos de error y reintentos](https://developers.google.com/workspace/gmail/api/guides/handle-errors).

No se ha instalado SDK de IA ni configurado llamadas pagadas. El coste actual de IA y de Bouncer causado por esta importación es cero; eso no sustituye los costes del VPS/Storage/Google que correspondan a la instalación. Antes de integrar IA, presentar presupuesto con volumen medido y proveedor elegido:

`coste IA = tokens de entrada / 1.000.000 × tarifa de entrada + tokens de salida / 1.000.000 × tarifa de salida + OCR/documentos + reintentos autorizados`.

Por ejemplo, una hipótesis de 10.000 mensajes × 1.000 tokens de entrada supone 10 millones de tokens, antes de PDFs y resultados. No es una estimación del buzón real ni un precio contratado. Medir una muestra, consultar precios oficiales del proveedor propuesto y acordar límite duro por lote/mes antes de habilitar llamadas. La próxima etapa debe añadir extracción con evidencias, conflictos revisables, reconstrucción de procesos y evaluaciones, y el underwriting de cuatro estados bancarios, sin emitir decisiones crediticias finales automáticamente.

## Comprobaciones locales

`pnpm install --frozen-lockfile --prod=false`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`. Las pruebas SQL usan Postgres local en memoria con fixtures ficticios y no consultan Supabase real. Cubren excepción histórica, permisos, deduplicación entre cuentas, reintentos, checkpoints, procesos, traspaso, selección de lenders y conservación al deshacer. OAuth, Pub/Sub, envío/descarga reales y la capacidad del VPS requieren el piloto externo.

## Correo nuevo (migración 016)

La redacción de mensajes nuevos y el estado de envíos requieren `supabase/migrations/016_manual_email.sql`, adicional a la actualización 009–015. Aplicarla antes de desplegar esta versión en web y worker. El procedimiento y la prueba real están en [MAIL-PILOT.md](MAIL-PILOT.md). No modifica las credenciales ni activa llamadas de IA o Bouncer. Los envíos históricos manuales respetan su excepción de elegibilidad; las campañas siguen requiriendo direcciones verificadas.

## Participantes del equipo (migración 017)

Aplicar **solo** `supabase/migrations/017_gmail_team.sql` sobre 001–016, como postgres y con respaldo previo, antes de actualizar web y worker. No volver a ejecutar el paquete de históricos ni las migraciones anteriores. No hay variables nuevas. Los trabajos de conversaciones del equipo requieren el worker actualizado; no iniciar asociaciones hasta que termine su despliegue.

En Configuración → Importación histórica, revisar el participante y elegir «Miembro del equipo». Registrar su dirección exacta, rol Seller o Closer y relación interna/colaborador externo. Vincular un usuario del CRM es opcional y exige un usuario activo del rol adecuado; no concede acceso comercial, de remitente ni de autenticación. «Correos del equipo» permite registrar y editar direcciones antes de futuros análisis. La clasificación se reutiliza entre cuentas y análisis; no se aplica por dominio.

Registrar la identidad excluye esa dirección de la selección comercial y bloquea una importación como cliente incluso desde una selección anterior. No borra contactos, oportunidades ni trabajo previo. Si ya se había importado como cliente, revisar esos expedientes manualmente: no se archivarán ni corregirán automáticamente. No inicia Bouncer ni envía correos.

Los mensajes siguen disponibles en el archivo y en los hilos asociados; muestran Equipo, Seller/Closer e interno/externo junto a sus participantes. Revisar cada conversación individualmente, abrir su correo de respaldo y seleccionar un expediente aprobado, proceso y evaluación del lender cuando corresponda. Una asociación incluye todo ese hilo, nunca todos los hilos de una compañera. Una conversación que mezcla clientes queda pendiente. Los conflictos con asociaciones existentes se rechazan sin sobrescribirlos. La incorporación en segundo plano usa páginas persistentes e idempotentes y conserva los criterios habituales de documentos; no crea clientes ni modifica responsables, cuenta principal o estados comerciales.

Un correo del equipo no cuenta automáticamente como respuesta del cliente/lender, no cancela su campaña y no reinicia la espera externa. En el expediente, un usuario con edición y acceso al área del lender puede confirmar una respuesta transmitida por una compañera, usando un correo personal posterior de esa misma conversación y explicando lo que comunica. La decisión queda en la línea del tiempo, cierra la tarea de espera del lender y abre la espera de actuación del equipo desde la fecha del correo. No implica oferta, aprobación, firma ni desembolso. Se conservan los cinco días calendario; las respuestas automáticas no son evidencia suficiente.

Comprobación local de esta etapa: 53 pruebas y compilación de producción correctas. Las pruebas nuevas cubren registro por correo, perfiles compatibles, selección histórica obsoleta, una compañera en dos expedientes, conflictos de asociación, permisos privados, espera del lender, confirmación con evidencia y recuperación del worker tras fallo parcial. La interfaz se verificó con mensajes ficticios en un servidor local; no se enviaron correos reales durante estas pruebas. Después de desplegar web y worker desde el mismo commit, clasificar una dirección de equipo y asociar una conversación conocida como prueba de aceptación de la instalación.
