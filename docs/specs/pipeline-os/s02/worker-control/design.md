# Diseño WC-I01

El loop actual programa tareas y envíos antes de claim_job. Se añade una bifurcación temprana: paused conserva heartbeat sin DB/proveedores; pilot usa un runtime estrecho, no el loop normal. El modo normal es el default compatible. Antes de desplegar se deberá seleccionar paused/pilot explícitamente y controlar el autoarranque, no inferir pausa de Composio apagado.

Una tabla privada con RLS y RPCs solo de servicio guarda cuenta, outbox, destinatario, transporte, deadline, lease hash, claim único y contadores. La adquisición persiste una vez y no caduca para permitir takeover automático: un reinicio bloquea y exige conciliación. Deadline máximo15min y cupos acotados son validaciones técnicas del ensayo, no autorización de tráfico. Revocar no borra estado.

Claim específico conserva el cuerpo de brand_b2.claim y añade el filtro de cuenta/outbox/manual, sin modificar la función normal. Debe verificarse su huella base al instalar; un cambio B2 requiere reconciliar el candidato. Un trigger impide que el mensaje reservado se reclame por el camino normal. Después de un claim, ni cuota conocida ni crash permiten otro claim dentro del ensayo. Cierre retiene mensajes queued como paused; sending/uncertain no se reenvían.

AsyncLocalStorage aporta el contexto inmutable de ejecución a la fachada Gmail y al proxy Composio. Sin contexto no cambia el tráfico normal de la app. Dentro de pilot se valida antes del token; la reserva durable se hace junto al wire, después de la guarda final de marca. El refresco OAuth directo del piloto usa una única petición fetch con timeout/redirect manual, sin retry del SDK. Tokens válidos se reutilizan sin gastar un HTTP ficticio. Revocar no puede retirar una petición ya iniciada: se contabiliza y se concilia, sin reintentar el envío.

El runtime solo llama sendNext con claim específico y syncLiveThread para el thread_id persistido del outbox sent. Ingestión puede escribir evidencia, asociaciones/notificaciones internas y encolar jobs; no los ejecuta. El piloto requiere otros workers normales/replicas y despachos manuales fuera de alcance detenidos/drenados. No se promete aislamiento de procesos antiguos, ni presupuesto de DB/Storage como si fuera HTTP de Gmail.

SQL aquí es candidato de ensayo no numerado, fuera de supabase/migrations; no se aplica remotamente. La numeración/final de release se coordinará con F2. Rollout futuro: SQL revisado → workers paused → configuración privada del ensayo → pilot autorizado. Reversa: volver a paused, conciliar inflight; no borrar ensayos ni restaurar guardas antiguas. No se cambia el selector Composio.

ADR-WC01: preferir estado/lease durable a flags o contadores en memoria; preferir un camino específico sin productores generales a filtrar después de claim global. Pruebas PGlite no acreditan contención física PostgreSQL multiconexión; ese límite se registra en verificación.
