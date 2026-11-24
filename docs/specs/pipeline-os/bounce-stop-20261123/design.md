# Diseño propuesto

## Discovery observado

src/lib/gmail-history.ts clasifica permanente/temporal únicamente a partir de Status en partes message/delivery-status con body.data. Mezclas de estados o ausencia de esa parte se convierten en delivery_report; todavía no existe un resultado estructurado por destinatario en MailSnapshot. La ruta antigua de worker/gmail.ts detiene y suprime solo permanent_bounce.

La ruta continua ingestLiveMessage archiva snapshot y llama gmail_associate_continuous/gmail_link_message. La lectura productiva del catálogo mostró gmail_link_message delegando en gmail_link_message_v23; registra naturaleza y eventos, y distingue correo personal, pero no contiene una llamada de bloqueo por rebote. La búsqueda productiva de funciones con permanent_bounce no devolvió handlers. Es evidencia del hueco de integración, sin diagnosticar el MIME exacto de la captura, que no se descargó.

Ya existen suppress_contact, stop_contact_sequence y comprobaciones de supresión antes del despacho. Se reutilizarán después de conciliar sus definiciones productivas, conservando gates de marca/admisión, leases y resultados inciertos. La tabla solicitada está en tasks-overview.tsx; sus agregados provienen de src/lib/pipeline-os/tasks-overview.ts y del lector de servidor correspondiente.

## Recepción y correlación

Un parser puro produce resultados por destinatario: email normalizado, Action, Status, Diagnostic-Code, motivo y referencias originales. Soporta MIME anidado, partes adjuntas que requieren lectura adicional y formatos documentados de Google. Los fallos al recuperar datos son reintentables de lectura; jamás de envío.

Implementación: se guarda el código enhanced SMTP y motivo normalizado; el archivo cifrado conserva el texto original. Una tabla privada recuerda exclusiones independientes aun si su INSERT encuentra conflicto con el bloqueo. El desbloqueo no las elimina. La reversa conserva las protecciones.

No se confía solo en remitente, asunto o correos citados. Cada resultado debe vincularse con evidencia de outbox de la misma cuenta y destinatario, usando Message-ID/referencias originales y, cuando sea inequívoco, el hilo. Los reportes con varios destinatarios se procesan individualmente. Una notificación positiva de entrega no es rebote; un mensaje personal que cite un error tampoco lo es.

La lectura real confirmó que Gmail reemplaza algunos Message-ID enviados por el CRM: los cuatro avisos con coincidencia de cuenta/destinatario/hilo de la muestra usan el RFC real archivado, no message_id_header del outbox. `correlation.sql` une la referencia real a través del gmail_message_id exacto del outbox. `thread-correlation.sql` cubre el orden de llegada inverso del archivo saliente, únicamente si el hilo Gmail de esa cuenta no contiene otro destinatario aceptado. Ambas revisiones se ensayan con la cadena completa; no se edita silenciosamente el SQL ya aplicado.

## Persistencia y control

Propuesta aditiva: eventos de entrega con clave única de cuenta/aviso/destinatario, y un bloqueo comercial activo por dirección. Registrar tipo, evidencia, fecha y desbloqueo. Preservar suppressions existentes: un desbloqueo por buzón lleno no puede eliminar una baja voluntaria u otro impedimento independiente.

La aplicación del evento y la cancelación de pendientes se realizan en una transacción idempotente, bloqueando la identidad del contacto. Los callbacks repetidos no generan nuevas cancelaciones, conteos ni avisos. Se conserva el estado sent como aceptación histórica de Gmail y se añade el resultado de entrega; no se falsean cifras previas.

La prohibición se comprueba al seleccionar campaña, crear mensaje comercial, reclamar outbox y justo antes de efectuar el POST. Un envío ya transmitido puede terminar antes de que llegue el aviso; no puede retirarse ni repetirse. Los mensajes sending/uncertain conservan su tratamiento de conciliación.

## Tabla y detalle

Rebotados cuenta direcciones únicas con fallo de entrega confirmado desde esa cuenta; el total deduplica entre remitentes. Conserva el historial aunque luego se desbloquee, mientras el detalle distingue bloqueo actual y rebote histórico. Mostrar motivo y estado de envío, sin mezclar DSN con Contestados ni convertirlo en etapa comercial.

## Recuperación histórica

Primero un informe de solo lectura con vinculados/ambiguos/no recuperables y pendientes afectados. Aplicar únicamente casos demostrados. Usar archivos ya disponibles; cuando falte evidencia MIME, preparar lectura puntual de Gmail. No usar Bouncer, reenviar mensajes ni levantar bloqueos históricos durante la recuperación.
