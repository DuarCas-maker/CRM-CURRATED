# Conversaciones: integración del prototipo aprobado

La pantalla usa la distribución de `index (4).html`: selector compacto arriba, bandeja a la izquierda y detalle de correo a la derecha. Reutiliza el CRM, React, Next.js, los iconos existentes y la paleta negra, champagne y bronce. Los nombres y porcentajes ficticios del prototipo no se incluyen en producción.

## Comportamiento implementado

- Selector único con búsqueda por contacto, empresa, correo principal y correos de contactos vinculados a la empresa. La consulta usa RLS y pagina las opciones de 50 en 50. Seleccionar cierra el desplegable.
- Resumen compacto con antigüedad del último correo entrante de contactos del cliente, documentos requeridos aprobados, próxima tarea o acción registrada y lenders contactados según `mail_case_stats`.
- Pestañas Todos, Cliente, Equipo y Lenders. Los contadores representan hilos únicos. Se mantienen búsqueda en mensajes, filtro de atención pendiente, bandeja de correos sin asociar y filtro de proceso.
- Dos columnas en escritorio y tableta horizontal; lista y detalle con botón Volver en pantallas estrechas. El chat tiene scroll propio. El encabezado grande y el pie del CRM se ocultan únicamente en esta pantalla para liberar altura.
- Orden inicial por mensajes más recientes y selector de orden. Cambiar el orden conserva el borrador y las páginas cargadas.
- Editor compacto para responder al mensaje original, con cuenta receptora por defecto y cambio a otra cuenta autorizada. Responder a todos conserva los participantes visibles y ajusta las copias al cambiar de cuenta.
- Se conservan nuevo correo, reenvío, destinatarios, CC/CCO, registro de contactos, documentos, adjuntos recibidos, archivos locales, firma de Gmail, borradores privados y estados reales de envío. El editor usa las acciones existentes; el modo antiguo mantiene `reply`, la cuenta y el destinatario que resuelve el backend, sin exigir una firma ni presentar opciones que esa acción no soporta. Las funciones avanzadas respetan el indicador de integración existente.
- Se conserva la revisión de adjuntos para incorporarlos al expediente y la asociación manual de hilos pendientes. La previsualización pendiente lee el archivo cifrado existente, sin solicitar una nueva lectura de Gmail.

## Identidad de los hilos

Desde el cambio de agrupación por empresa, la pestaña Lenders muestra una conversación por expediente, proceso de financiación y empresa. Distintos contactos, integrantes del equipo, cuentas e hilos originales de la misma empresa se reúnen en esa vista. Un mensaje entrante pertenece a la empresa de su remitente, aunque haya otros lenders en copia; un envío compartido aparece como contexto en cada empresa destinataria, sin duplicar el correo almacenado.

Los mensajes de Cliente, Equipo y Por clasificar conservan la agrupación por hilo original y referencias RFC, dentro del mismo expediente y proceso. La vista de lenders conserva los identificadores físicos de cada mensaje y conversación: responder toma el mensaje seleccionado, su asunto y sus referencias reales, incluso al cambiar de cuenta. La cabecera resume participantes del lender y del equipo; todos los destinatarios originales siguen disponibles en el detalle del correo. Las copias ocultas no se incluyen automáticamente en Responder a todos.

## Datos que faltan o necesitan una definición

- **Porcentaje de seguimiento:** no existe una fórmula oficial ni un campo equivalente. Se muestra «No definido» con una pista visual neutra. Hace falta acordar los criterios antes de calcularlo.
- **Sin leer:** conserva `conversations.needs_attention`, que significa pendiente de atención en el CRM. No representa la etiqueta `UNREAD` de Gmail y abrir un correo no modifica Gmail. Sincronizar lectura real necesita un cambio específico posterior.
- **Correo de empresa:** `companies` no tiene un campo de correo propio. La búsqueda utiliza los correos reales de `contacts` y `company_contacts` vinculados como primary, contact o broker.
- **Sin asociar:** corresponde a la bandeja existente de las cuentas cuya revisión permite el backend. Los contadores por categoría en esta bandeja corresponden a la página cargada; el total de pendientes se muestra aparte.

## Servicios, acceso y seguridad

La migración `022_lender_company_conversations.sql` añade el nombre de contacto al directorio, importa la tabla aprobada de 32 empresas y 55 correos, indexa el historial y los futuros mensajes por empresa y habilita la cola de respuesta al lender seleccionado. Conserva los permisos de expediente y cuenta, MFA, controles de adjuntos y referencias de Gmail. No hay nuevas librerías ni variables de entorno. El trabajador, OAuth, las credenciales y la configuración de sincronización no se modifican.

`GET /api/conversations/clients` es una lectura nueva con autenticación y MFA existentes. `GET /api/conversations/channels` conserva sus campos anteriores y añade resumen de hilos y contexto. `GET /api/mail/review/[id]?thread=true` añade historial paginado; exige el mismo permiso de revisión del endpoint anterior y limita la lectura a la cuenta y al hilo del registro autorizado.

Los textos de correo se renderizan mediante `MailBody`, escapados como texto, con el historial original disponible. La firma mantiene su vista previa aislada existente. No se registran cuerpos ni credenciales en consola.

La pantalla conserva la consulta periódica y el botón Actualizar existentes. La llegada de correos depende del trabajador y su sincronización; este rediseño no garantiza entrega instantánea.

Las consultas de resumen cargan cabeceras y el último fragmento de cada conversación, y los cuerpos del detalle siguen paginados. Las búsquedas amplias de contactos y expedientes muy grandes pueden requerir optimización de consultas en una tarea posterior, sin inventar resultados parciales ni cambiar el modelo aquí.

## Archivos

- `src/components/crm.tsx`: integración y apertura de expedientes y adjuntos autorizados.
- `src/components/mail-inbox.tsx`: exportación compatible de la nueva pantalla.
- `src/components/conversations-workspace.tsx` y `.css`: distribución, bandeja, detalle, resumen y responsive.
- `src/components/mail-client-picker.tsx`: selección y búsqueda de clientes.
- `src/components/mail-message.tsx`: mensajes, identidad, participantes y acciones.
- `src/components/mail-editor.tsx`: presentación compacta y selección de cuenta.
- `src/components/mailbox-status.tsx`: presentación compacta de recepción, borradores y asociación.
- `src/lib/conversation-threads.ts`: identidad, clasificación, filtros y antigüedad.
- `src/lib/mail-display.ts`: plegado de historial citado de Outlook sin modificar el original.
- `src/lib/server/conversation-summary.ts`: lectura autorizada de resúmenes e identidades.
- `src/app/api/conversations/clients/route.ts`: búsqueda real de clientes y alias.
- `src/app/api/conversations/channels/route.ts`: contexto y resúmenes adicionales.
- `src/app/api/mail/review/[id]/route.ts`: historial pendiente paginado.
- `tests/conversation-threads.test.ts`: agrupación y aislamiento entre expedientes y procesos.
- `tests/mail-editor-compatibility.test.ts` y `tests/mail-readable-outlook.test.ts`: compatibilidad del editor básico, permisos de cuenta, modo avanzado, demostración e historial citado.

## Validación ejecutada

- Build de producción y generación de tipos / TypeScript: correctos.
- Suite automática: 84 pruebas aprobadas. Incluye envío, recepción mediante trabajador con servicios de prueba, firmas, adjuntos, permisos, idempotencia y doce pruebas nuevas del rediseño.
- Pruebas de aceptación de base de datos: migraciones 001–021 y los 16 grupos de aceptación aprobados en PGlite.
- Formato de los componentes, servicios y rutas del rediseño y `git diff --check`: correctos. El proyecto no tiene script de lint; no se afirma haberlo ejecutado.
- Navegador con datos ficticios y servicios locales de prueba: búsqueda por correo principal y alias de empresa, selección y cierre, cambio de cliente y contexto, filtros y contadores, mensajes de Daniel/Laura/lender en un único hilo, paginación, orden y conservación del borrador, asociación, revisión de adjuntos y apertura del reenvío.
- Respuesta de prueba: conserva modo `reply`, mensaje original, conversación y expediente; usa otra cuenta autorizada y mantiene CC. El servidor de prueba no contacta Gmail.
- Escritorio 1440×900: barra del cliente de aproximadamente 67 px, tres mensajes completos visibles en el ejemplo, scroll interno y sin scroll vertical de toda la página. Tableta horizontal y vertical y móvil 390×843 comprobados; en móvil se verificó Volver a la lista.
- Aplicación local: salud 200 y nuevas lecturas sin sesión 401.
- Aplicación local autenticada con servicios reales: carga de hilos y mensajes guardados, búsqueda por correo, selección de cliente, cierre del selector y respuesta básica habilitada sin errores. No se enviaron correos desde esta sesión de validación.

En la configuración local inspeccionada, `GMAIL_HISTORY_ENABLED` está desactivado. Se mantiene el modo básico; no se alteraron este indicador ni la configuración OAuth. Nuevo correo, reenvío, firma y cambio de cuenta están implementados con los servicios avanzados existentes y necesitan que dicha integración esté habilitada y correctamente configurada en el entorno correspondiente. Una prueba de firma anterior devolvió «Organization is not configured» en localhost; la respuesta básica ya no solicita esa consulta.

Una prueba de ida y vuelta enviando un correo real con el rediseño no se ha ejecutado. Requiere un destinatario de prueba acordado; las comprobaciones con datos ficticios no se presentan como entrega real de Gmail.

## Conversaciones por empresa lender — 13 de octubre de 2026

La configuración acordada es una conversación por cliente + proceso + empresa, visible en la pestaña Lenders. Los contactos de la misma empresa y los integrantes del equipo comparten esa vista. Aparece cuando hay un mensaje enviado o recibido, sin generar chats vacíos para todo el directorio.

- Los mensajes se identifican primero por correo exacto y después por dominio propio con una única empresa registrada. Los dominios de proveedores compartidos (Gmail, Outlook, etc.) y dominios asignados a varias empresas requieren un correo exacto. No se unen empresas distintas por usar el mismo proveedor.
- Una empresa desconocida dentro de un intercambio ya identificado con lenders se registra provisionalmente con «Por confirmar · dominio». No se inventa su razón social ni criterios comerciales. Los mensajes automáticos, contactos del cliente, equipo y conversaciones independientes aún sin identificar no generan empresas provisionales.
- El historial se indexa en dos pasadas, primero las empresas conocidas y luego las provisionales, para reconocer respuestas anteriores a la incorporación del directorio. El trigger aplica la misma regla a mensajes nuevos; no crea oportunidades ni cambia de cliente, propietario o etapa.
- El detalle carga únicamente los IDs de mensajes que corresponden a la vista elegida, de 100 en 100 por conversación original. Esto evita descargar primero cientos de respuestas de otros lenders para llegar a las de la empresa seleccionada. Búsqueda y snippets se calculan por mensaje, no por todo el hilo mixto.
- «Responder» utiliza el remitente de ese mensaje. En un envío saliente compartido toma un destinatario de la empresa seleccionada. «Responder a todos» agrega contactos de esa empresa y equipo, excluyendo al cliente, otros lenders, el remitente de la cuenta seleccionada y BCC. El backend vuelve a verificar empresa, origen, caso, evaluación y permisos antes de encolar.
- Las respuestas de lenders funcionan también en modo básico usando `lender_reply`, con destinatario, copias y cambio de cuenta autorizada. Los adjuntos, firma, reenvío y nuevo correo mantienen el indicador de integración avanzada existente. Las respuestas básicas del cliente conservan su flujo anterior.
- No se crean evaluaciones para responder a un correo histórico. Una respuesta a otra empresa dentro de un hilo mixto no hereda la evaluación comercial del lender original.

### Migración pendiente de aprobación

`supabase/migrations/022_lender_company_conversations.sql` está preparada y probada en bases locales aisladas. No se ha aplicado a Supabase ni se ha importado el directorio en producción. Se debe aplicar completa una sola vez después de 021, con aprobación del usuario, antes de desplegar los cambios de aplicación que usan sus nuevas funciones.

Añade `lender_contacts.name`, un índice de dominio, las funciones de clasificación/registro/respuesta y la tabla entregada como importación transaccional. Reutiliza empresas por nombre, dominio o registro de correo. Conserva notas y configuración existentes; si encuentra varias empresas coincidentes, una empresa archivada o conflictos de direcciones, aborta toda la migración para revisión, sin reasignar contactos silenciosamente. Los productos y condiciones financieras no vienen en la tabla: las empresas nuevas conservan los valores vacíos del modelo y se deben configurar después si se desean utilizar en selección comercial.

### Archivos del cambio por empresa

- `src/lib/lender-mail.ts`, `src/lib/conversation-threads.ts`, `src/lib/server/conversation-summary.ts`: identificación, agrupación, participantes, destinatarios, fragmentos y búsqueda.
- `src/components/conversations-workspace.tsx`, `mail-editor.tsx`, `mail-message.tsx`, `lender-contacts.tsx`, `crm.tsx`: selección por empresa, paginación, respuesta básica/avanzada, nombres y estado de envío.
- `src/app/api/conversations/channels/route.ts`, `src/app/api/conversations/[id]/messages/route.ts`, `src/app/api/actions/route.ts`: directorio, lectura acotada de mensajes y acción de respuesta al lender.
- `src/lib/server/mail-actions.ts`, `mail-manager.ts`, `workspace.ts`, `src/lib/mail-manager.ts`, `domain.ts`: cola, nombres de contactos y metadatos compatibles.
- `supabase/migrations/022_lender_company_conversations.sql`: migración pendiente de aplicar.
- `tests/lender-conversations.test.ts`, `lender-database.test.ts`, `conversation-threads.test.ts`, `mail-editor-compatibility.test.ts`: aislamiento por empresa/cliente/proceso, referencias originales, importación histórica, destinatarios, permisos, cuentas, idempotencia y compatibilidad.

### Validación del cambio por empresa

Build de producción y TypeScript correctos. Pruebas de aceptación de base de datos correctas con migraciones 001–022 en PGlite. Suite completa: 90 pruebas aprobadas, ninguna fallida. Verificación de formato de los archivos del cambio y `git diff --check` correctas. No existe un script de lint en el proyecto.

En navegador con servicios locales ficticios se verificaron dos empresas en el mismo hilo, contadores, contactos compartiendo chat, exclusión de mensajes de otro lender, paginación de 100 a 136 mensajes incluyendo el original compartido, respuesta desde otra cuenta con copias solo al equipo, y navegación en escritorio, tableta 1024×768 y móvil 390×843. La barra superior midió aproximadamente 65 px en la vista de escritorio; el historial conserva scroll interno. Esa respuesta se envió al servidor de prueba, no a Gmail. No se ha ejecutado la importación ni una respuesta real de New Day en producción.

## Ampliación del directorio y portales

El usuario confirmó las relaciones Funding Futures/MCA Deals, los dos contactos de Itria y la dirección `fundsmefast.com`, y autorizó registrar las empresas faltantes del Excel y los portales. Se añadieron en la base configurada 12 empresas y 18 correos, se completaron los 13 nombres vacíos aportados por el archivo y se archivó el registro provisional de Ricardo como lender. La consulta posterior verificó los 107 correos del archivo registrados. La operación conserva mensajes y productos/criterios financieros existentes; no envía correos. Los 19 nombres provisionales restantes requieren confirmación de nombre; no se renombraron automáticamente por abreviaciones del archivo.

La migración `023_lender_directory_portals.sql` está preparada y probada en PGlite, pendiente de ejecutar en Supabase. Permite varios lenders Portal sin correo, evita registrar direcciones vacías, excluye direcciones internas de Curated, conserva el archivo de Ricardo y su evidencia, y une el alias provisional `fundingfutures.biz` con el ID existente de MCA Deals bajo Funding Futures. Mantiene todos los mensajes, evaluaciones, importes y referencias; documenta la corrección en auditoría. Incluye el directorio completo para que instalaciones nuevas y la base actual converjan, reutilizando empresas y preservando nombres de contacto ya poblados.

Los tres portales son Loan Stacking, Idea y Rapid; sus enlaces originales se guardan en el campo de notas existente, sin añadir una columna ni inventar correos. MS Equities sigue pendiente de un correo o enlace. `src/components/lender-form.tsx` y `src/lib/lender-directory.ts` añaden selección de canal, correo opcional para Portal, enlace HTTPS requerido y validación común. El endpoint de acciones valida esos campos; las tarjetas muestran el enlace y el editor de correo excluye lenders sin destinatario de las campañas de envío.

Validación: 92 pruebas aprobadas, build y TypeScript correctos, aceptación de migraciones 001–023 y pruebas de exclusión interna, dos portales sin correo, referencias comerciales del alias unido y conservación de los mensajes. No se ha aplicado 023 ni probado el guardado de un portal contra la base real. Los datos añadidos ya están en la base real; la web necesita el commit/push habitual para publicar el nuevo formulario.
