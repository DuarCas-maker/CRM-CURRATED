# Evidencia de recuperación

T01:14 pruebas pasan, cero fallos (clasificación/secretos, worker de campaña y controles de piloto/paused); TypeScript y build webpack correctos sobre95114ab. El primer ensayo paralelo con el build agotó10 s esperando el heartbeat paused; aislado pasó y la repetición completa serial pasó. No se relajó timeout ni test.

T01 modifica únicamente clasificación de errores y su persistencia existente en finish_job. Códigos desconocidos/proveedor/payload/cause permanecen redactados; SQLSTATE se valida. No cambian permisos, cuotas, envío, lease, backoff ni estados de cola.

T01 productivo: a19/11 00:02:48Z, gmail_sending_usage volvió a fallar con QGR_DENIED; fecha de uso sin actualizar, cuenta sin ruta/health moderno. Confirma el rechazo de contexto del camino directo anterior.

T02:54 pruebas de regresión pasan (facade real con SDK/red ficticios, permisos SQL, cuotas, integración, worker, propietario y control de campaña).13 pruebas dirigidas pasan después de cerrar la validación de política y compatibilidad con piloto. Una prueba adicional de estado operativo pasa: bloqueo total frente a espera parcial, cero pendientes y campaña pausada. TypeScript sin errores. Build webpack correcto; la elección webpack evita una limitación local de Turbopack con node_modules enlazado fuera del worktree, sin cambiar configuración productiva.

Ensayo PostgreSQL nativo15.19: función exacta, permisos service_role, lease/claim, cuenta ajena, vencimiento, ruta/health modernos, política cerrada, consulta incierta sin envío y reversa/reinstalación. Fixture estructural de los esquemas privados de exclusión/cuotas; no representa un stack completo Auth/PostgREST. native-result.json fija el SHA del SQL efectivamente probado. Cero llamadas reales a proveedores en las pruebas.

Revisión causal: la solicitud requiere prueba durable y misma cuenta; se revalida antes de credenciales, después de esperar cuota y antes de emitir. Las lecturas no pueden enviar; dispatch permite una sola solicitud de envío por contexto, y conciliación permite solo búsqueda. Se conservan reservas/admisión QGR, B2, caducidad de uso, límites y bloqueo de rutas modernas. Ninguna modificación de datos de campaña, destinatarios o credenciales.

Navegador local con datos ficticios: aviso de sincronización visible en listado y detalle; conserva diseño y estado de programación. Cuando existe otro remitente listo no se etiqueta toda la campaña como bloqueada.

SQL productivo aplicado19/11 00:21:08Z después del respaldo reciente: una función añadida, cero funciones existentes cambiadas; anon/authenticated sin ejecución. Recibo en sql-application.json. No se invocó ninguna operación de envío desde el agente.

Pendiente: publicar código T02 y verificar avance real del uso y de la cola; no declarar recuperación por tener pruebas verdes.
