# Control de campañas — SDD STRICT

Implementación local autorizada. Base a881100; publicación/migración remota posterior requiere aprobación del candidato completo. Ronda cerrada: 1A campaña unificada con varios remitentes de la misma marca y primer contacto único; 2A verificar/revisar Bouncer, filtrar/excluir, repartir, programar/pausar y seguimiento actual; 3A asignación fija, reasignación manual de pendientes; 4A límite global más límites por remitente.

## Diagnóstico observado en lectura

Una campaña activa, sin scheduled_at, activada a las18:40 de Bogotá, ventana09–17. Once destinatarios activos y once outbox queued, cero aceptados por Gmail. Remitente principal:436 mensajes/24h (435 externos y uno CRM), límite350 y reserva20; cupo de campaña0. Segunda cuenta desconectada y sin lectura de uso. Ver datos carga correctamente once filas; faltan motivos de espera en la UI. Worker procesa trabajos de sincronización/uso. No se invocaron claims, proveedores, verificación, envío o cambios remotos.

Funnel observado:1978 contactos únicos accesibles,35 válidos,1852 pendientes sin error técnico,73 errores402,8 dudosos,10 inválidos. Los resultados inciertos no se reintentan automáticamente. El error402 describe la última solicitud, no el saldo actual del proveedor.

| FR / AC | Resultado verificable |
| --- | --- |
| FR-01 / AC-01 | Campañas abre un resumen coherente: campañas por estado, contactos únicos por verificación, enviados/pendientes/respuestas. Filtros por lote y categoría abren filas paginadas y motivos; sin sumar duplicados de Excel ni mezclar cupo Gmail con elegibilidad. |
| FR-02 / AC-02 | Cada campaña muestra enviados confirmados, pendientes, errores/inciertos, respuestas, remitentes y bloqueos por horario, cupo, cuenta, permisos/marca y conciliación. Datos desconocidos se identifican; cuenta desconectada/sin sincronización no muestra disponibilidad utilizable. |
| FR-03 / AC-03 | Crear desde un lote permite varios remitentes autorizados de una sola marca, reparto determinista sin duplicar contactos, límites por remitente y total. Activar/programar/pausar opera sobre toda la campaña de forma atómica y manual. |
| FR-04 / AC-04 | Reasignación manual únicamente de contactos pendientes sin despacho admitido o envío incierto/confirmado; conserva historial y cancela el intento antiguo sin modificar su identidad congelada. No hay redistribución automática. |
| FR-05 / AC-05 | Verificación Bouncer seleccionada, con cantidad/créditos confirmados, errores técnicos solo tras reconocer causa resuelta. Reconciliación incierta bloqueada; idempotencia y revalidación completa sin cola parcial. |
| FR-06 / AC-06 | UI Pipeline minimalista, mismos tokens y modo oscuro, responsive360/768/1280, teclado/carga/vacío/error; preview ilustrativo existente y CRM clásico conservados. |
| FR-07 / AC-07 | Rol/MFA/origen en servidor y SQL, RLS y ACL cerradas, mismo control de marca y admisión de envío. Límite global de24h seguro ante competencia; rechazos no despachan ni consumen intentos. |

No objetivos: ampliar cupos actuales, reconectar cuentas/OAuth, comprar créditos, verificar contactos reales, reintentar/activar campañas o enviar correos durante desarrollo/smoke; seguimientos automáticos nuevos, resends de contactos ya contactados o redistribución automática. Límites técnicos existentes:5000 contactos por campaña y20 remitentes por configuración; no truncado silencioso.

Condición de compatibilidad FR-04: el destino de una reasignación debe carecer de enrollment histórico para ese contacto. La unicidad y la intención anterior se conservan; se muestra CC_TARGET_HISTORY si no es admisible. Este incremento no recicla intentos anteriores.
