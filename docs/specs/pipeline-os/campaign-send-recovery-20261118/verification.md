# Evidencia de recuperación

T01:14 pruebas pasan, cero fallos (clasificación/secretos, worker de campaña y controles de piloto/paused); TypeScript y build webpack correctos sobre95114ab. El primer ensayo paralelo con el build agotó10 s esperando el heartbeat paused; aislado pasó y la repetición completa serial pasó. No se relajó timeout ni test.

T01 modifica únicamente clasificación de errores y su persistencia existente en finish_job. Códigos desconocidos/proveedor/payload/cause permanecen redactados; SQLSTATE se valida. No cambian permisos, cuotas, envío, lease, backoff ni estados de cola.

T01 productivo: a19/11 00:02:48Z, gmail_sending_usage volvió a fallar con QGR_DENIED; fecha de uso sin actualizar, cuenta sin ruta/health moderno. Confirma el rechazo de contexto del camino directo anterior.

T02:54 pruebas de regresión pasan (facade real con SDK/red ficticios, permisos SQL, cuotas, integración, worker, propietario y control de campaña).13 pruebas dirigidas pasan después de cerrar la validación de política y compatibilidad con piloto. Una prueba adicional de estado operativo pasa: bloqueo total frente a espera parcial, cero pendientes y campaña pausada. TypeScript sin errores. Build webpack correcto; la elección webpack evita una limitación local de Turbopack con node_modules enlazado fuera del worktree, sin cambiar configuración productiva.

Ensayo PostgreSQL nativo15.19: función exacta, permisos service_role, lease/claim, cuenta ajena, vencimiento, ruta/health modernos, política cerrada, consulta incierta sin envío y reversa/reinstalación. Fixture estructural de los esquemas privados de exclusión/cuotas; no representa un stack completo Auth/PostgREST. native-result.json fija el SHA del SQL efectivamente probado. Cero llamadas reales a proveedores en las pruebas.

Revisión causal: la solicitud requiere prueba durable y misma cuenta; se revalida antes de credenciales, después de esperar cuota y antes de emitir. Las lecturas no pueden enviar; dispatch permite una sola solicitud de envío por contexto, y conciliación permite solo búsqueda. Se conservan reservas/admisión QGR, B2, caducidad de uso, límites y bloqueo de rutas modernas. Ninguna modificación de datos de campaña, destinatarios o credenciales.

Navegador local con datos ficticios: aviso de sincronización visible en listado y detalle; conserva diseño y estado de programación. Cuando existe otro remitente listo no se etiqueta toda la campaña como bloqueada.

SQL productivo aplicado19/11 00:21:08Z después del respaldo reciente: una función añadida, cero funciones existentes cambiadas; anon/authenticated sin ejecución. Recibo en sql-application.json. No se invocó ninguna operación de envío desde el agente.

Publicación T02: c250fea enviado a main sin force push. Worker observado con203 admisiones reales de cuota en la ventana de10 minutos, fecha de uso actualizada y seis tareas recientes Gmail sync/usage completadas sin error. La operación proviene del worker normal; ninguna invocación claim/send/finish ni ajuste artificial del uso desde el agente.

Lectura de cierre19/11 00:31:46Z (18/11 19:31:46 America/Bogota): los mismos50 destinatarios,3 correos con ID Gmail confirmado y47 en cola, cero fallidos/inciertos. Los3 expedientes avanzaron al primer recordatorio; fechas calculadas desde su envío confirmado. Se observó avance en varias lecturas (1,2,3 enviados) y sincronizaciones posteriores completadas. No significa que los50 correos o los recordatorios futuros hayan terminado: la cola sigue su ritmo y sus controles vigentes. Evidencia acotada en production-recovery.json.

Web: nuevo chunk observado en DOM productivo contiene el marcador de bloqueo; health200 y API de campañas anónima401 con no-store. Evidencia en public-postflight.json. La sesión del navegador integrado no terminó de renderizar el workspace productivo, por lo que no se afirma revisión autenticada completa; la verificación de la campaña se hizo con lecturas SQL acotadas y la visual se realizó localmente con datos ficticios.
