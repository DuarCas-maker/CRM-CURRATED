# Aceptación

- AC-001: 5.1.1 de dirección inexistente bloquea la dirección y detiene recordatorios en cualquiera de las cuentas. El expediente conserva su etapa y asesor.
- AC-002: 4.2.2 o aviso de buzón lleno, incluso con clase 5 y motivo mailbox full, produce bloqueo con ese motivo; no se levanta por tiempo ni por resultado posterior válido de Bouncer.
- AC-003: un rechazo de política no convierte automáticamente la dirección en inexistente. Un reporte positivo, autorespuesta o texto citado no genera rechazo falso.
- AC-004: un DSN mixto afecta solo a los destinatarios con fallo/demora correspondiente, con evidencia de envío correlacionada. Los avisos ambiguos quedan en revisión.
- AC-005: callbacks, sincronización, reconexión y backfill repetidos producen el mismo resultado sin duplicar eventos, conteos ni consumo.
- AC-006: con otra cuenta, otra campaña, reimportación y envío comercial manual sigue bloqueado. Se verifica concurrencia entre recepción, claim y despacho; lo ya aceptado por Gmail conserva su conciliación.
- AC-007: Rebotados refleja correos únicos por cuenta y en total; su detalle explica motivos y estado actual. Contestados no aumenta por avisos automáticos.
- AC-008: solo administrador activo con MFA y permisos correspondientes puede desbloquear; requiere motivo. No puede borrar bajas voluntarias ni reanudar recordatorios cancelados.
- AC-009: backfill concilia avisos demostrados y conserva casos ambiguos. No envía correos ni consume Bouncer. Pruebas de permisos, SQL/reversa y lectura de tabla pasan con volumen representativo.
