# Evidencia de recuperación

T01:14 pruebas pasan, cero fallos (clasificación/secretos, worker de campaña y controles de piloto/paused); TypeScript y build webpack correctos sobre95114ab. El primer ensayo paralelo con el build agotó10 s esperando el heartbeat paused; aislado pasó y la repetición completa serial pasó. No se relajó timeout ni test.

T01 modifica únicamente clasificación de errores y su persistencia existente en finish_job. Códigos desconocidos/proveedor/payload/cause permanecen redactados; SQLSTATE se valida. No cambian permisos, cuotas, envío, lease, backoff ni estados de cola.

Pendiente: código real de tarea después del despliegue, corrección causal y avance productivo de la campaña. No declarar la recuperación por publicar observabilidad.
