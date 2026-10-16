# Documentos, aplicación y paquetes para lenders

## Activación

Después de las migraciones 001–031, ejecutar **032_bank_documents.sql**, **033_company_applications.sql** y **034_lender_document_packages.sql**, en ese orden, desde el SQL Editor de la instancia Supabase. No ejecutar nuevamente las migraciones anteriores. Desplegar la web y el worker desde el mismo commit y recargar el CRM.

Para la gestión directa de bancos y orden, ejecutar después **035_bank_document_management.sql** completo (`begin;` a `commit;`). No requiere variables adicionales. El despliegue de Coolify por push actualiza la aplicación, pero no ejecuta las migraciones de Supabase.

Para la incorporación simplificada y sugerencias por contenido, aplicar después **036_document_intake.sql** completo. La función de recepción solo puede invocarla el servidor que verificó usuario, permisos y bytes del archivo. La clasificación requiere `OPENAI_API_KEY` también en el servicio **web** de Coolify (no basta con tenerla en el worker); reutiliza el modelo de Configuración → Análisis. Nunca se expone la clave al navegador.

## Incorporación simplificada

Documentos muestra únicamente archivos reales. Los espacios vacíos existentes se conservan internamente para reutilizarlos al guardar y no aparecen como bancos sin archivos. El contador distingue **4/4 extractos recibidos** de **0/4 aprobados**. Cuatro archivos distintos de BMO completan la recepción mínima, aunque existan cuatro espacios vacíos antiguos sin banco. Los extractos aprobados de cualquier banco completan el mínimo de aprobación; una copia idéntica cuenta una sola vez.

Desde el adjunto de una conversación, **Incorporar y revisar** muestra el archivo y propone su tipo leyendo el contenido. Los impuestos, cuentas por pagar y facturas se clasifican como otros documentos. El tipo es editable; si no puede identificarse, se elige manualmente. El banco se sugiere por el nombre del archivo o, como respaldo, por el único banco que ya tiene archivos en la oportunidad. Indicar banco es obligatorio al guardar extractos. La IA no determina el banco ni aprueba documentos.

**Se guardará como** muestra el siguiente número del banco. Se reutiliza primero un espacio vacío de ese banco o uno sin banco, antes de crear otro. Se puede guardar incluso si la oportunidad aún no tiene checklist. **Incorporar archivo** usa el mismo flujo con PDF, JPG o PNG subidos desde el equipo. La opción avanzada permite reemplazar un archivo seleccionado explícitamente, con control de versión y confirmación.

**Guardar** incorpora como recibido y cierra la ventana. **Guardar y aprobar** exige confirmar la revisión del archivo mostrado y su pertenencia a la empresa; recepción, banco, número, procedencia y revisión se confirman en una sola transacción. Una solicitud desactualizada no sobrescribe el archivo de otro usuario; un reintento confirmado no duplica la aprobación.

La clasificación usa Responses con el PDF o imagen real, salida JSON validada y `store:false`. Se conserva una sugerencia privada por versión exacta para evitar llamadas repetidas al abrir la misma revisión. No hay reintentos automáticos de solicitudes inciertas; un fallo permite continuar manualmente o solicitar otro intento. Los ensayos de IA usan únicamente PDF ficticios.

## Gestión de bancos desde Documentos

Cada extracto tiene **Cambiar banco / orden**. También se pueden seleccionar varios extractos (o todos) y usar **Cambiar banco / ordenar seleccionados**. Elegir un banco existente o escribir uno nuevo, indicar la posición inicial y ordenar los seleccionados con las flechas. La vista previa muestra el resultado antes de guardar.

La operación es atómica: renumera consecutivamente los bancos afectados sin duplicar posiciones. Conserva archivos, estado de aprobación, notas, revisor e historial. Registra auditoría y rechaza una lista desactualizada por cambios simultáneos. Un análisis que utilizó la clasificación bancaria anterior queda desactualizado y debe revisarse.

## Campos de aplicación

La estructura sigue los datos del formulario CF-007: cinco tipos de entidad, estados de EE. UU. y D. C. en desplegables, direcciones separadas (calle, ciudad, estado y ZIP), EIN `12-3456789`, SSN visible `123-45-6789` y segundo propietario Sí/No. Teléfono y ZIP conservan entrada libre; los porcentajes permiten decimales. Los datos nuevos de dirección se incluyen en el PDF. Las direcciones antiguas se conservan en su campo original; no se infieren ciudad, estado ni ZIP.

Para generar o firmar se exigen nombre legal, entidad, EIN, estado de constitución, fecha de inicio y, para cada propietario, nombre, SSN, nacimiento (18 años mínimo) y participación de 0 a 100. La suma no puede exceder 100. Los correos, si se completan, deben ser válidos; correos, teléfonos y direcciones son opcionales. Se pueden guardar borradores incompletos.

El asesor se precarga con el seller responsable de la oportunidad; los usuarios con permiso de edición pueden corregirlo. Como los perfiles no tienen un código comercial separado, el identificador inicial es el ID estable del perfil y puede sustituirse por su código comercial. Se completan datos de asesor faltantes en borradores antiguos; las versiones firmadas no se modifican automáticamente.

La aplicación no añade controles para cargar documentos: se gestionan desde Documentos.

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
