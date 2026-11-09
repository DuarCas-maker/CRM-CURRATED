# Aceptación WC-I01

- AC01/WC01: paused y pilot reciben dobles que fallan si se invoca cualquier productor/claim global; configuración desconocida falla antes de usarlos.
- AC02/WC02: junto a outbox/notificación ajenos, solo cambia el mensaje exacto elegible y conserva sus checks B2, destinatario y permisos.
- AC03/WC03: segunda adquisición/reinicio/segundo claim no permiten enviar; contadores sobreviven a un runtime nuevo y no devuelven reservas fallidas.
- AC04/WC04: otra cuenta/recurso/proveedor, presupuesto agotado o revocación producen cero OAuth/red; token expirado consume exactamente una reserva por intento sin retry oculto.
- AC05/WC05: lectura solo del hilo persistido tras aceptación; sin messages/history/watch/paginación global ni ejecución de notify/jobs.
- AC06/WC06: vencimiento/stop limita futuras solicitudes; pérdida de respuesta mantiene consumo y sending/uncertain sin replay.
- AC07/WC07: permisos anon/auth negados, servicio mediante RPC; invariantes de fuentes ajenas y49 hashes operativos conservados. Red solo ficticia.
