# Diseño y decisión

La sincronización de uso sigue siendo condición previa del envío. No se modifican timestamps a mano, flags de seguridad ni estados de mensajes para forzar una salida.

T01: el worker clasifica únicamente errores conocidos y SQLSTATE válidos. `checked` conserva su mensaje genérico, añadiendo código seguro en un tipo propio. El catch de tareas persiste ese código mediante finish_job, con el mismo backoff y lease. No hay SQL nuevo.

T02 confirmado: a19:02 del18/11 America/Bogota, la tarea normal gmail_sending_usage registró QGR_DENIED después de publicar b1d87c4. Cuenta anterior sin simple_mail.health ni mail_runtime.routes. La nueva política global deja a esas tareas sin contexto; no es necesario renovar Google.

Una RPC aditiva `legacy_worker_mail_context` solo para service_role valida cuenta conectada con credencial directa, ausencia de ruta/alta modernas y prueba durable: job running con lease vigente y account_id exacto, o outbox sending con brand_claim_token exacto. Devuelve huella de cuenta y prueba, sin credenciales. No escribe datos.

Un contexto AsyncLocalStorage interno se instala únicamente alrededor del trabajo reclamado y del envío reclamado del worker. La fachada Gmail lo convierte en scope por solicitud, acotado a la misma cuenta, operación de lectura del job o firma/envío del outbox. Revalida la prueba/huella antes de credenciales y de la emisión; sigue pasando por reserve/admit de QGR y B2. Contextos ausentes, cruzados, caducados, con cambio de ruta o con cuenta desconectada quedan cerrados. Nuevos buzones/routing y pilotos conservan sus caminos previos. No se agrega un bypass genérico a gmail().

La conciliación de un outbox incierto obtiene únicamente permiso GET de búsqueda de enviados, sin permiso POST. No se reenvían resultados inciertos. La prueba de tarea/envío caduca conforme al lease de5 minutos y se cancela si cambia la cuenta, la política se cierra o aparece una ruta/alta modernas.

T03: la UI agrega motivo de bloqueo al estado Activa/Programada cuando todos sus remitentes con pendientes necesitan sincronización. Un remitente sano conserva el avance de un grupo parcialmente bloqueado. No cambia el estado durable ni confunde aceptación de Gmail con entrega o lectura.

Riesgo material: reparar la sincronización permite al worker retomar campañas activadas por el usuario. Esa recuperación forma parte de esta autorización. Se observará la campaña afectada sin iniciar otra campaña ni emitir un mensaje de prueba.
