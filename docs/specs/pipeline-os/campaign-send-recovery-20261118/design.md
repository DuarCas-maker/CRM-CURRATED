# Diseño y decisión

La sincronización de uso sigue siendo condición previa del envío. No se modifican timestamps a mano, flags de seguridad ni estados de mensajes para forzar una salida.

T01: el worker clasifica únicamente errores conocidos y SQLSTATE válidos. `checked` conserva su mensaje genérico, añadiendo código seguro en un tipo propio. El catch de tareas persiste ese código mediante finish_job, con el mismo backoff y lease. No hay SQL nuevo.

T02 se fijará contra el error productivo observado y el contrato vigente de95114ab. Si se confirma el hueco de compatibilidad de cuentas directas anteriores con QGR, el permiso será acotado a trabajo interno del worker y a la cuenta/camino directo autorizado; el limitador por cuenta/grupo y la admisión real siguen obligatorios. No se agregará un bypass genérico a gmail().

T03: la UI agrega motivo de bloqueo al estado Activa/Programada cuando corresponda. No cambia el estado durable ni confunde aceptación de Gmail con entrega o lectura.

Riesgo material: reparar la sincronización permite al worker retomar campañas activadas por el usuario. Esa recuperación forma parte de esta autorización. Se observará la campaña afectada sin iniciar otra campaña ni emitir un mensaje de prueba.
