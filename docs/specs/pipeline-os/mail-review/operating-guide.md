# Usar la revisión de correo en Pipeline OS

## Antes de empezar

Requiere publicar el código y aplicar el delta coordinado `migrations/053_pipeline_mail_review.sql`, previa revisión del catálogo y autorización del entorno. No repetir 048–052. La implementación local no activa producción. Usa la clave existente `A_OPENAI_API_KEY` y el modelo configurado del CRM; el consumo se registra en **Completar aplicación / application_extraction**, compartido con extracción documental. No se crea otro servicio ni clave.

## Recorrido

1. Abrir un expediente en Pipeline OS con sesión y MFA de superadmin/closer autorizado. La revisión de ofertas y requisitos no amplía acceso a sellers.
2. Si el correo no tiene expediente, abrir Conversaciones → Pendientes y elegir un expediente y proceso existentes. No se crea un expediente desde esta revisión.
3. En el panel del expediente, abrir **Revisar correo con IA**. Elegir el mensaje de origen. Se listan 20 mensajes por página; Más correos conserva la paginación. La vista previa puede estar recortada; el original está en Conversaciones.
4. Confirmar proceso y evaluación de lender. Se respetan asociaciones existentes. Si falta una evaluación, prepararla con los controles actuales de Lenders y ofertas y después actualizar la lectura.
5. Pulsar **Analizar correo**. Solo esa acción consulta IA, sobre el texto del mensaje; no descarga Gmail/adjuntos ni ejecuta envíos. El texto citado del historial/firma se excluye del input legible. Puede proponer oferta, requisito o desconocido. Un importe sin evidencia literal compatible queda vacío.
6. Leer el correo y las citas; corregir producto/importe/términos o requisito, resumen del update y título de tarea. Si se corrige un importe, revisar también los textos del resumen y la tarea. Elegir responsable con acceso comercial y vencimiento en hora local. No se interpreta una oferta como aceptada ni un archivo como aprobado.
7. **Aprobar y crear registro, tarea y update** guarda todo en una transacción: oferta/requisito, tarea, actividad, acontecimiento y revisión con fuente/actor/fecha. La asociación de proceso/evaluación ausente se completa en ese momento. Una asociación contradictoria debe corregirse primero en Conversaciones.
8. Comprobar el resumen confirmado, oferta/requisito, responsable y vencimiento; abrir Tareas, Lenders y ofertas o Updates para continuar. El original del modelo y la corrección humana se conservan por separado.

## Si falla

- **Actualizar lectura** solo consulta estado guardado; no vuelve a consumir IA.
- Fallo de análisis: revisar primero el intento persistido. Reintentar análisis es una acción explícita que puede consumir IA; no hay reintento automático. Un intento en curso/incierto requiere al menos cinco minutos para un nuevo intento explícito.
- Fallo de aprobación: se conservan los campos editados y la misma identidad de solicitud. Si la aprobación ya se guardó, actualizar estado permite recuperarla sin crear registros duplicados.
- Mensaje o asociación modificados: la aprobación se rechaza. No se sobreescribe otra relación ni se usa el nombre comercial como clave.
- Si se corrige una asociación o el contenido antes de aprobar, actualizar la lectura y usar **Reintentar análisis** explícitamente. El intento anterior queda archivado y se prepara una propuesta nueva. Las revisiones ya aprobadas no se reinician.
- Contrato SQL ausente: la revisión informa la instalación pendiente; el tablero anterior conserva su funcionamiento.

## Alcance verificado

Pruebas locales con fuentes ficticias, proveedor falso y base embebida; no equivalen a piloto Gmail/OpenAI ni contención PG15 nativa. La demo simula la revisión temporalmente y no altera el tablero real. Recepción continua depende del worker/cuentas existentes; esta entrega no los reanuda.
