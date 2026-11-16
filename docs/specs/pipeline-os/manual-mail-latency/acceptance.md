# Aceptación

- AC-001: un proceso de lectura retenido no impide que un manual alcance el sender en un tick.
- AC-002: una cuenta bloqueada no monopoliza el dispatcher; máximo cuatro cuentas simultáneas y un envío por cuenta. Descubrimiento dinámico de cuentas nuevas.
- AC-003: un segundo manual después de 1 s puede reclamarse, sin diferir un minuto; si otro envío de esa cuenta sigue sending, no se reclama.
- AC-004: campañas, campaign_test y notification_id nunca son manuales; un envío reciente conserva su intervalo original.
- AC-005: consulta rápida inicial y backoff comprobados; cleanup cancela el timer y pestaña oculta no carga datos.
- AC-006: RPC deniega anon/authenticated, selección exacta, marca/permisos revocados bloquean, cupo agotado y Retry-After aplazan, doble claim no entrega dos veces y sending/uncertain no se reencolan.
- AC-007: flag falso y paused/pilot conservan compatibilidad; apagado detiene nuevas admisiones sin repetir operaciones en vuelo.

Datos de ensayo: cuentas y clientes ficticios *.test, nunca registros de producción.
