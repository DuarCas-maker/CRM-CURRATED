# Aceptación

1. Un lote duplicado no duplica el total; filtro y páginas conservan alcance. El funnel suma sus categorías únicas y separa verificación de elegibilidad/cuotas.
2. Campaña activa con once queued, fuera de09–17 y sin cupo muestra ambos motivos, cero enviados y cuenta/horario. Cuenta desconectada o uso desconocido no ofrece un cupo disponible ficticio.
3. Configurar2 remitentes de la misma marca reparte cada contacto una sola vez. Marca distinta, cuenta no autorizada o snapshot obsoleto revierten todo. Cada límite individual y el global se respetan.
4. Confirmar programación establece scheduled_at; activar no equivale a envío fuera de ventana. Pausar agrupa todos los miembros. Editar tras revisar exige confirmación nueva.
5. Reasignar pendientes conserva outbox viejo cancelado y una sola secuencia activa; admitidos/inciertos/enviados o selección obsoleta fallan sin efectos parciales.
6. Bouncer requiere confirmación y cantidad; replay no duplica; inciertos permanecen bloqueados. 402 explica la última solicitud.
7. Dos claims concurrentes con límite global1 nunca producen2 despachos; notificaciones/manual y campañas previas conservan su comportamiento.
8. UI observada a360/768/1280, oscuro y teclado, con carga/vacío/error; no se imprime ni guarda información personal productiva.

Compatibilidad verificada: nuevas campañas del CRM clásico entran al panel después del backfill. Un destino con enrollment histórico devuelve CC_TARGET_HISTORY sin cambiar la asignación; no se reciclan request_key. La reversa de grupos múltiples devuelve CC_KEEP_GROUP_LIMIT y conserva la protección global.
