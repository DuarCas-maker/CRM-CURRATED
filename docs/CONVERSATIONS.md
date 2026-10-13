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

Los mensajes de un mismo registro de `conversations` se muestran juntos. Copias o respuestas desde otras cuentas se agrupan cuando comparten `internet_message_id`, referencias RFC o una relación explícita `outbox.reply_message_id`. La agrupación exige el mismo expediente y no une procesos de financiación distintos. No se agrupa por asunto, remitente o nombre de lender. Las copias ocultas no se utilizan para clasificar participantes.

La agrupación es de presentación: conserva los identificadores originales que utilizan el envío, los adjuntos y las políticas de acceso. Un hilo sin referencias suficientes permanece separado; resolverlo automáticamente por semejanza requeriría una regla adicional aprobada.

## Datos que faltan o necesitan una definición

- **Porcentaje de seguimiento:** no existe una fórmula oficial ni un campo equivalente. Se muestra «No definido» con una pista visual neutra. Hace falta acordar los criterios antes de calcularlo.
- **Sin leer:** conserva `conversations.needs_attention`, que significa pendiente de atención en el CRM. No representa la etiqueta `UNREAD` de Gmail y abrir un correo no modifica Gmail. Sincronizar lectura real necesita un cambio específico posterior.
- **Correo de empresa:** `companies` no tiene un campo de correo propio. La búsqueda utiliza los correos reales de `contacts` y `company_contacts` vinculados como primary, contact o broker.
- **Sin asociar:** corresponde a la bandeja existente de las cuentas cuya revisión permite el backend. Los contadores por categoría en esta bandeja corresponden a la página cargada; el total de pendientes se muestra aparte.

## Servicios, acceso y seguridad

No hay nuevas migraciones, cambios de permisos, librerías ni variables de entorno. El trabajador, OAuth, las credenciales y la configuración de sincronización de Gmail no se modifican.

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
