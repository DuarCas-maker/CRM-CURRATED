# Aceptación

1. Cien seleccionados entre 4.004 contactos, con ingreso y plantilla financiera, generan una sola campaña y cien inscripciones locales dentro de 8 s. Repetir request_key devuelve la misma campaña; otro payload rechaza.
2. Un contacto inválido, suprimido o sin ingreso; un actor sin MFA o ajeno; una plantilla obsoleta: se rechazan sin crear campaña parcial.
3. Se conserva ingreso/modelo congelado, cuatro recordatorios y asignación al creador. El ensayo no crea outbox ni usa proveedores.
4. Reversa restaura exactamente el cuerpo anterior; aplicar dos veces falla cerrado. Guardias de hashes rechazan drift.
5. Timeout HTTP devuelve 503 y un mensaje seguro; errores de datos mantienen su tratamiento.
