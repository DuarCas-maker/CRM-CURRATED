# Guardado de verificación y recuperación — STRICT

Solicitud del 23/11/2026: corregir en bloques de 100, publicar y conciliar exclusivamente los 502 leads con el lote existente, sin otra verificación ni consumo duplicado. Alcance y aclaración cerrados por la instrucción expresa del usuario.

## Causa confirmada

El worker reserva hasta 1.000 verificaciones antes del POST de pago. Después intenta actualizar todos sus UUID mediante un filtro URL PostgREST. Con 502 UUID únicos la URL supera 19 KB y el proxy devuelve HTTP 414. El trabajo termina con DATABASE_OPERATION_FAILED y las reservas quedan inciertas, sin guardar el ID devuelto por Bouncer. La reproducción aislada con el SDK confirmó el mismo error. El saldo no explica este fallo de persistencia; los 423 errores históricos HTTP 402 son otro conjunto y quedan fuera del cambio.

## Requisitos

- FR-001: actualizar estados y motivos en bloques de hasta 100 IDs, tanto en aceptación como en rechazo explícito del proveedor.
- FR-002: mantener un único POST de verificación por reserva; no reencolar solicitudes inciertas ni agregar reintentos de pago.
- FR-003: localizar el lote existente y comparar exactamente sus correos únicos normalizados con las 502 reservas afectadas antes de modificar datos.
- FR-004: recuperar sus resultados con la función existente y publicar únicamente el arreglo y sus pruebas/documentación; preservar datos y cambios ajenos.
- NFR-001: no registrar secretos ni correos de clientes; evidencia agregada, hashes y metadatos operativos.

No se modifican importación, selección de leads, campañas, límites, credenciales ni esquemas.
