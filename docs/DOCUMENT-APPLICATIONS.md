# Documentos, aplicación y paquetes para lenders

## Activación

Después de las migraciones 001–031, ejecutar **032_bank_documents.sql**, **033_company_applications.sql** y **034_lender_document_packages.sql**, en ese orden, desde el SQL Editor de la instancia Supabase. No ejecutar nuevamente las migraciones anteriores. Desplegar la web y el worker desde el mismo commit y recargar el CRM.

La generación utiliza `pdf-lib` en el backend existente del CRM y guarda el PDF en el Storage privado de Supabase. No usa DocRaptor ni n8n, ni requiere otra API key. No se añadió una Edge Function: se aprovecha el servidor que ya ejecuta el CRM para evitar otro servicio de conversión.

El texto de declaraciones corresponde al PDF de ejemplo facilitado por el usuario, conservando su redacción. `FORM_DECLARATION_TEXT`, si está configurado, sustituye ese texto. La firma guarda una copia exacta de las declaraciones revisadas: una modificación posterior de configuración no cambia un PDF firmado.

## Recorrido de prueba

1. En Conversaciones → adjunto → **Incorporar y revisar**, comprobar la vista previa. Se incluyen decodificadores, fuentes e ICC de PDF.js; los escaneos mayores de 16 MP ya no se omiten. Usar Siguiente/Anterior y descargar el original si el archivo está protegido o dañado.
2. En **Guardar este archivo como / Save this file as**, seleccionar el documento. Los extractos se numeran dentro de cada banco: `Bank Statement 1`, `Bank Statement 2`, etc. Indicar el banco, sin introducir el mes.
3. Crear más extractos o documentos adicionales cuando hagan falta. Incorporar el archivo y revisar el contenido antes de aprobarlo. Los archivos adicionales son opcionales por defecto; pueden marcarse obligatorios.
4. En Oportunidad → **Documentos**, comprobar los grupos de bancos. El mínimo es una aplicación aprobada y cuatro archivos de extractos distintos en total; no cuatro por banco. Las casillas vacías adicionales no bloquean el mínimo. Una misma copia repetida no cuenta como varios extractos.
5. Abrir **Completar aplicación / PDF**. Completar empresa, uno o dos propietarios y datos comerciales. Los datos se cifran, se comparten por empresa y conservan versiones. El servidor exige permiso de edición sobre la oportunidad para acceder a datos sensibles. Cambiar los datos descarta la firma del formulario y requiere firmar nuevamente.
6. Guardar un borrador o dibujar la propia firma como representante autorizado. El PDF identifica al representante y su capacidad; no se atribuye al cliente la firma realizada por un miembro del equipo. Para utilizar una aplicación firmada por el cliente, adjuntar ese archivo mediante el flujo documental.
7. **Guardar aplicación → Generar PDF e incorporar**. El PDF queda recibido; debe revisarse y aprobarse. Un borrador sin firma no puede aprobarse como aplicación firmada. Cada oportunidad conserva sus documentos y versiones: editar los datos compartidos no reemplaza automáticamente los archivos ya incorporados a otras oportunidades.
8. En el gestor de correo, seleccionar el modo lenders, proceso, empresas, contacto principal y copias por empresa. Seleccionar la aplicación aprobada y cuatro o más extractos, más los documentos deseados. Pulsar **Revisar paquete y correos** y comprobar destinatarios, asunto, mensaje y archivos. Solo **Confirmar y enviar** pone los correos en cola. Cada lender recibe un correo separado con el mismo paquete; una copia no puede pertenecer a otra empresa lender. La cola conserva la versión aprobada de cada archivo: reemplazarlo después no cambia el paquete que ya se confirmó.

## Límites y validación

Se conserva el máximo de 20 MB por documento. Guardar documentos no tiene un límite funcional fijo; el envío permite hasta 20 adjuntos por correo y el análisis hasta 24 documentos / 40 MB en total. El análisis identifica los períodos dentro de los archivos y permite el mismo mes en bancos diferentes. Las métricas se relacionan por documento, evitando mezclar ingresos de bancos distintos.

Las pruebas utilizan datos ficticios: permisos, versiones compartidas, conflictos de edición, numeración por banco, aprobación, separación de copias y paquetes, períodos coincidentes y borradores sin firma. La comparación visual del PDF reproduce un escaneo de 17 MP que el visor anterior mostraba en blanco. No se firman aplicaciones reales ni se envían correos reales durante estas pruebas.
