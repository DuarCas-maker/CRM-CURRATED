# Bloqueo comercial por rebote — STRICT

## Alcance confirmado

El usuario autorizó explícitamente implementar y publicar en crm.finlabinc.com el bloqueo, la cancelación, la revisión histórica y la columna Rebotados. Un buzón lleno permanece bloqueado hasta revisión y desbloqueo por un administrador con MFA, sin reanudación automática. Nivel STRICT por afectar envíos, datos personales y producción.

## Requisitos

- FR-001: reconocer reportes de entrega fallida o diferida por destinatario, preservando motivo/código SMTP y evidencia. Correlacionar cuenta, mensaje original y dirección normalizada antes de bloquear.
- FR-002: bloquear esa dirección en todas las cuentas del CRM para campañas, recordatorios y envíos comerciales manuales. Mantener las políticas de acceso existentes.
- FR-003: cancelar pendientes y detener inscripciones afectadas, con una segunda comprobación inmediatamente antes del despacho. No volver a enviar mensajes con resultado incierto ni intentar retirar mensajes ya aceptados por Gmail.
- FR-004: diferenciar dirección inexistente, buzón lleno, rechazo por política y otros errores. Un rebote no es una respuesta humana ni un rechazo comercial/financiero del expediente.
- FR-005: Bouncer, reimportaciones y cambios de campaña no levantan el bloqueo. Para buzón lleno, únicamente un administrador con MFA puede desbloquear con motivo registrado. El desbloqueo no reanuda recordatorios antiguos.
- FR-006: columna Rebotados después de Enviados · campañas en Correos del CRM, con consulta de contactos, motivo, fecha y cuenta original. Una dirección cuenta una vez por cuenta y una vez en el agregado global, respetando visibilidad.
- FR-007: conciliar avisos históricos disponibles y detener los pendientes correspondientes. Los casos ambiguos van a revisión, sin bloquear destinatarios por coincidencias de texto sueltas.
- NFR-001: idempotencia por cuenta/mensaje de aviso/destinatario, auditoría y evidencia sin exponer correos reales en logs o fixtures.
- NFR-002: pruebas offline y PostgreSQL nativo con volumen representativo. Ninguna verificación Bouncer ni correo real como prueba.

## Fuera de alcance

Modificar límites o DNS; rechazar negocios por correo inválido; borrar historial de envíos; contactar proveedores o clientes; reactivar secuencias automáticamente; sustituir la validación Bouncer.
