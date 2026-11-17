# Diseño

## ADR-001: biblioteca específica, infraestructura compartida

Reutilizar el renderer de formato seguro y el editor de campañas. Guardar plantillas de lenders en tabla específica, con versiones y RPC transaccional con CAS e idempotencia. Así no se altera el contrato de campañas (baja obligatoria, secuencias y assets). El selector admite copiar asunto/mensaje de plantillas de campañas existentes, rotuladas claramente. Nunca guardar el preview personalizado como plantilla.

## Contratos

- GET/POST `/api/mail/templates`: biblioteca de lenders, versiones y referencias a campañas; escritura solo superadmin/seller_admin, misma política que la biblioteca existente. Origen, sesión/MFA y límites de bytes existentes.
- POST `/api/mail/lender-preview`: mismo payload de correo a lenders; solo lectura. Autorización de expediente, cuenta, marca y fuentes existente. Resolver el expediente y directorio mediante el cliente autenticado/RLS. Retornar mensajes renderizados y digest SHA-256 del contenido revisado, destinatarios, documentos y firma.
- `mail_send`: reconstruir preview desde los registros actuales, exigir digest y usar exactamente asunto/texto/HTML revisados por target. Sin confiar en valores del cliente ni HTML arbitrario.
- La cola SQL conserva transacción, receipt e idempotencia. Quitar el tope 20 solo de targets, conservar CC y adjuntos. Extender la función instalada mediante sustituciones verificadas; fallar ante drift en vez de reemplazar guardas de permisos/fuentes. HTML generado por renderer común, sin insertar contenido de variables como markup.

## UX

Nuevo correo: modal de hasta 1180 px, header descriptivo, editor con bloques remitente/destinatarios/mensaje/documentos y preview al lado. En móvil se apilan. Selección completa, buscador y resumen de problemas, lista de seleccionados con desplazamiento propio. Biblioteca accesible desde navegación Pipeline OS y desde el editor, sin abandonar borrador. Preview por lender con To/CC/asunto/cuerpo/firma y contador de adjuntos. Confirmación final explícita mantiene el envío separado de preparar o guardar.

## Riesgos

El lote grande tarda más: se encola en una sola transacción y el worker entrega progresivamente bajo las cuotas existentes. Datos/firma pueden cambiar: digest obliga nueva revisión. Variables vacías/plantillas de campaña con enlaces específicos: bloquear y permitir editar. Una reversa que restablece el límite 20 debe conservar selecciones grandes; el rollback del esquema no destruye plantillas ni versiones.

## Implementación y límites materiales

Migración candidata 056: `lender_email_templates`, versiones inmutables para usuarios de aplicación y RPC `save_lender_email_template`; solo SELECT directo para usuarios activos con MFA. No hay tipos Supabase generados en esta base; se siguen sus interfaces TypeScript explícitas. `CampaignEditor` recibe props aditivas para campos/tamaño/disabled/required y una etiqueta accesible, sin alterar el contrato de campañas.

Variables: name (contacto completo), company, amount (USD), industry, phone, email, product y lender_name. No inferir ni inventar application_url/unsubscribe_url para lenders. Aplicar una plantilla es una copia editable del texto fuente, no un vínculo vivo con futuras versiones. Adjuntos, destinatarios y procesos no se guardan en ella.

La revisión SHA-256 detecta cambios en el contenido que se enviará, destinatarios, selección de archivos, cuenta, proceso, marca y firma. Es una comprobación de consistencia, no un token de autorización: permanecen los permisos actuales del servidor y SQL. La vista previa usa el HTML y texto del renderer compartido; las imágenes remotas de la firma se ocultan mediante CSP en el iframe aislado. Los adjuntos se autorizan y validan nuevamente en la cola existente.

Se preservan límites de recursos: request 300 KB (payload validado 280 KB), selección personal 100 KB, entrada RPC expandida 4 MB, CC 20 por lender, 20 adjuntos totales y 10 archivos Gmail. No se convierte ninguno en un tope fijo de 20 lenders. La cola sigue siendo una única transacción: un error cancela el lote y no se omiten lenders silenciosamente. No se cambió la política del worker ni los límites de la cuenta.

Corrección de QA: abrir el formulario de nueva plantilla después de montar el diálogo de biblioteca, para mantenerlo encima en la capa nativa y recibir foco. Al cerrar la biblioteca se recarga el selector sin perder el borrador. El bloqueo de variables al cambiar a correo directo no se aplica al texto literal de un reenvío histórico.
