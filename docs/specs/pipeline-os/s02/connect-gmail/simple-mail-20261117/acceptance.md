# Criterios de aceptación

Cada escenario debe probarse con fixtures; los escenarios remotos necesitan evidencia propia y no se declaran cumplidos por pruebas locales.

| AC | Escenario comprobable |
|---|---|
| AC-001 | Con usuario superadmin/MFA, cuatro tarjetas funcionan por teclado y a 360/768/1280px. Una cuenta conectada a dos proveedores no se duplica en totales. No aparece formulario normal de organización/marca/candidato/presupuesto/transporte. |
| AC-002 | Al iniciar con email esperado, autorizar Google con lectura/envío/offline y volver, se completa setup sin aprobaciones manuales intermedias. Recarga/callback duplicado/caída entre pasos producen una cuenta y un recibo. Otro email, hd, actor/state/cookie o sesión inválidos no conectan. |
| AC-003 | Composio con scopes efectivos y mismo email completa preparación sin registrar/confirmar manualmente binding. Una conexión recuperada válida se reutiliza. Sin scopes se pide autorización necesaria y se explica; no se atribuye consentimiento directo a Composio. |
| AC-004 | Email de asesor activo único asigna ese asesor; sin coincidencia, se exige selector. Perfil inactivo/ajeno/manipulado y default Workspace/marca ausentes fallan sin sustitución. Mailbox identity y Composio user ID no se usan como profile ID. |
| AC-005 | Asesor asignado puede usar la cuenta dentro de sus áreas/casos; otro asesor y anon no. Superadmin activo sí. Desactivación de actor, revocación o reasignación después del snapshot invalida operaciones en vuelo antes de emitir. |
| AC-006 | Cuenta nueva sincroniza desde 30 días y continúa con novedades. Mensaje/thread/adjunto repetido entra una vez; cambiar vía o reconectar no borra histórico anterior ni lanza dos ingestas. Responder conserva hilo/cabeceras y adjuntos válidos. |
| AC-007 | Conectar/reconectar habilita capacidades, pero campañas draft/paused y mensajes pausados permanecen sin arrancar. Solo Iniciar/Enviar crea la intención de emisión, sujeta a permisos/límites. Objetivo 500–700 no incrementa automáticamente límites vigentes. |
| AC-008 | Fallo clasificado de preparación directa + ticket durable cancelled_before_wire + claim vigente + respaldo verificado/cupo confirmado produce un único hijo Composio para ese mensaje. Dos workers, callback/job duplicado y replay no crean otro hijo ni otro POST. Crash antes/después del admission se prueba. Timeout/5xx/malformed/mark_sent fallido después de emisión quedan uncertain sin otro POST. 401/403/429 de envío, pausa/revocación/contexto obsoleto y resultado de búsqueda vacío nunca activan fallback. |
| AC-009 | Cada medidor aplicable y uso global están cubiertos por un límite gratuito verificable. Cupo agotado, evidencia vieja, plan desconocido o reserva concurrente excesiva deniegan Composio antes de llamar; la cuenta principal válida no se desactiva. No hay upgrade, pago, crédito comprado ni fallback a otra integración. |
| AC-010 | Se muestran estado real, último sync exitoso y motivo accionable sin códigos internos. Candidato no se muestra como Lista. Respaldo que envía y sync principal averiado muestran el problema de lectura. UI no consulta proveedores por cada render. |
| AC-011 | Upgrade desde base vigente y deltas integrados conserva IDs, permisos legítimos, mensajes/hilos y campañas. Gmail legacy funciona con feature nueva apagada. Reversa no borra recibos ni reenvía uncertain. Instantly/TextTorrent no cambian ni reciben llamadas. |

## Matriz negativa mínima

Permisos: superadmin sin MFA, inactivo, asesor propio, asesor ajeno, anon y worker con capacidad vencida. Concurrencia: mismo Idempotency-Key con payload distinto, setup simultáneo, desconexión durante setup/envío, dos workers, claim expirado y cambio de revisión entre reserva/admisión. Costos: cupo cero, última unidad reservada por dos solicitudes, rollover de mes con evidencia atrasada y consumo fuera del CRM. Entrega: fallo de preparación conocido, fallo de DB al guardar no emisión, timeout tras admisión, proveedor acepta y mark_sent falla, conciliación sin resultados y reinicio del worker.

La propiedad comprobada es impedir un segundo POST cuando el resultado del primero sea incierto; no se afirma entrega exactly-once remota ni se usa Message-ID como idempotencia del proveedor.
