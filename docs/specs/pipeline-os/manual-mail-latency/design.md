# Diseño técnico

## Ejecución

El recorrido anterior espera scheduler, campañas, sender y un job en una sola secuencia. La nueva vía manual usa un bucle independiente de 750 ms dentro del mismo worker, habilitado por MANUAL_MAIL_FAST_SEND_ENABLED=true solo en normal. Default false conserva el recorrido anterior; paused/pilot no crean el dispatcher. Se conservan heartbeat y parada.

El dispatcher descubre cuentas dinámicamente, rota la prioridad y admite hasta cuatro envíos de la vía rápida por proceso, uno por cuenta en memoria. El sender general anterior continúa existiendo; ambos usan la misma exclusión de cuenta en PostgreSQL. Un buzón lento no ocupa todos los slots. La parada bloquea nuevos trabajos y espera los iniciados.

## Persistencia y concurrencia

SQL propio en migrations/manual-mail-latency.sql, sin editar 048–053 o los candidatos sellados. Comprueba huella de claim B2 y dueño de instalación. Añade helpers privados y dos RPC service_role: manual_mail_ready_accounts() y claim_manual_outbox(account uuid). SECURITY DEFINER con search_path vacío; anon/authenticated no pueden ejecutar. El helper privado no concede acceso directo al servicio.

El claim común valida snapshot, permisos, marca, cuota, elegibilidad, admisión y conciliación previos. Un advisory lock por cuenta protege entre procesos; sending bloquea otros canales del mismo buzón aunque la preparación dure más de 30 s. Los manuales esperan 1 s entre envíos; los demás conservan 30 s y defer de 1 min. Se preserva el orden de manuales por created_at/id, incluyendo el primero aplazado. Índices parciales cubren due y orden de cuenta.

El cambio SQL aplica la cadencia manual al instalarse, incluso con el dispatcher apagado. El flag deshabilita el bucle independiente; la reversa SQL restaura también el pacing original. Los mensajes existentes no se actualizan, copian, reencolan o borran por instalar/revertir.

## Transporte y UI

Se reutiliza sendNext/MIME/firma/transportes/cuotas/Request-ID. Un claim de cuenta exacta no cae al claim global y una respuesta de cuenta/tipo incorrecto se rechaza antes del transporte. Un POST incierto permanece uncertain y no se repite. No se habilitan proveedores ni se suben límites.

La UI consulta cada 1 s hasta 15 s, 2 s hasta 60 s y 5 s después. No consulta si está oculta o hay una carga del hilo en curso, evitando abortar continuamente una consulta lenta. El timer se cancela al cerrar el estado pendiente. No hay endpoint ni permisos nuevos.

## ADR-001

Se elige bucle independiente y claim atómico reutilizado para evitar que una sincronización larga retrase al sender. Se conserva un solo servicio y los controles del transporte; no se envía directamente desde la petición HTTP del usuario ni se mantienen transacciones DB durante la llamada Gmail. La concurrencia física se probó con PG15; los tiempos de mocks no acreditan un SLA productivo.
