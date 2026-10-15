# Revisión documental — punto 1

El CRM permite incorporar adjuntos del gestor de correo nuevo y del flujo anterior al checklist de la misma oportunidad. Recibir un archivo nunca lo aprueba automáticamente.

## Activación

Aplicar `supabase/migrations/025_document_review.sql` después de las migraciones 001–024, antes de desplegar la web actualizada. No ejecutar nuevamente el instalador inicial. El worker existente conserva la recepción y copia de adjuntos; esta etapa no añade variables de entorno ni conecta IA.

La migración agrega referencias entre los adjuntos y los documentos, evidencia de origen por versión e historial de revisión. La asociación, el registro de la versión y el recibo de la operación se confirman en una transacción. La carga a Storage ocurre antes: un fallo de confirmación puede dejar un objeto privado sin referencia; el usuario puede reintentar sin duplicar la versión.

## Recorrido de aceptación

1. En Conversaciones, abrir un cliente y un correo con PDF, JPG o PNG. Los hilos sin expediente deben asociarse primero mediante el recorrido existente.
2. Elegir «Incorporar y revisar» / «Revisar adjunto». Comprobar empresa, fecha e identificador de la oportunidad y la vista previa.
3. En «Guardar este archivo como», seleccionar el documento. Se pueden agregar extractos por banco y otros documentos opcionales. El adjunto solo puede incorporarse al expediente de su conversación: no se trasladan archivos entre oportunidades automáticamente.
   Si el expediente importado muestra Documentos 0/0, usar «Crear checklist de aplicación y extractos» desde Documentos o desde el diálogo del adjunto. Esta acción crea únicamente requisitos pendientes, sin incorporar ni aprobar archivos; los reintentos conservan los documentos existentes.
4. Incorporar el archivo. Queda recibido; a continuación se abre la revisión del documento incorporado.
5. Comprobar contenido, empresa y banco; marcar la casilla de revisión y aprobar, pedir corrección con notas o mantener pendiente. No se pide introducir el período; se identificará durante el análisis. Varios bancos pueden tener extractos del mismo mes.
6. Abrir Documentos en la oportunidad: comprobar los grupos por banco, estado, notas, responsable y fecha. El mínimo es una aplicación y cuatro extractos distintos en total, más los documentos adicionales marcados obligatorios.
7. Reemplazar el archivo con un adjunto diferente: debe quedar recibido, sin la aprobación ni las notas de la versión anterior. Las versiones y revisiones anteriores se conservan.
8. Con dos ventanas abiertas, incorporar una nueva versión en una y guardar la revisión anterior en la otra. Debe rechazarse la aprobación obsoleta; recargar la revisión antes de continuar.
9. Repetir con otro seller y con una oportunidad traspasada: se mantienen los permisos del expediente y de su fase. Las lecturas del correo compartido no conceden permiso de modificación documental.

La vista previa compara la huella de los bytes mostrados con la versión del checklist. El servidor vuelve a comprobar esa versión al guardar. Solo PDF, JPG y PNG hasta 20 MB se incorporan; HTML y SVG no se previsualizan como documentos.

La demostración incluye un expediente vacío y un adjunto ficticio de Evergreen Logistics para recorrer creación del checklist, incorporación, corrección y aprobación sin descargar archivos ni modificar datos reales. Sus cambios se reinician al recargar.

## Validación

- Pruebas de base de datos: acceso, MFA, separación entre oportunidades, adjuntos antiguos y nuevos, recibos sin duplicados, notas obligatorias y versiones. La ampliación 032–034 añade bancos, aplicaciones y paquetes independientes; ver [DOCUMENT-APPLICATIONS.md](DOCUMENT-APPLICATIONS.md).
- Suite de pruebas del repositorio, tipos y compilación de producción.
- Interfaz de demostración: revisión, corrección con notas y contador de aprobaciones.
- Comprobación visual en escritorio y móvil (390 × 844). Captura de escritorio: `docs/document-review-preview.jpg`.

La suite local se ejecutó con Node 24.19.0 y pnpm 11.25.0 disponibles en esta sesión; el proyecto y sus imágenes de producción fijan Node 22 y pnpm 11.19.0. No se cambió esa configuración.

La activación en Supabase y un recorrido con un correo y archivo reales del entorno desplegado requieren aplicar la migración y desplegar esta versión. Las pruebas locales no se presentan como una validación de ese despliegue.
