# Envío manual con baja latencia

SDD STRICT · implementación local autorizada · 15/11/2026 America/Bogota · base 01b6d3f.

## Clarificación cerrada

1 → A: el usuario pide acelerar correos manuales y respuestas para todas las cuentas conectadas, manteniendo la cadencia de las campañas. Incluye buzones futuros porque el comportamiento será común al worker. No autoriza por sí solo push, SQL remoto o despliegue de este incremento.

## Diagnóstico y alcance

El worker espera cada sincronización antes de volver a enviar. Lectura de producción sin cuerpos ni direcciones: un correo manual permaneció queued durante 394441 ms, con cero intentos, mientras gmail_sync estaba running. La función B2 aplica 30 s por cuenta y difiere 1 min. La UI consulta cada 5 s. No se enviaron mensajes de prueba por este diagnóstico.

| FR     | Resultado                                                           | AC                                                                            |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| FR-001 | Vía independiente para manuales/respuestas en todas las cuentas     | AC-001: un job bloqueado no bloquea envíos manuales                           |
| FR-002 | Una operación de envío por cuenta; varias cuentas progresan         | AC-002: cuenta lenta no impide otras; concurrencia acotada                    |
| FR-003 | Manuales sin demora artificial de 30/60 s                           | AC-003: guardas de identidad/cuota/reintento vigentes; pacing manual 1 s      |
| FR-004 | Campañas, pruebas de campaña y notificaciones conservan su cadencia | AC-004: no entran en la vía manual y conservan 30/60 s                        |
| FR-005 | Estado visible oportuno                                             | AC-005: consulta inicial 1 s, con reducción de frecuencia tras esperas largas |
| FR-006 | Sin duplicados ni cambio de permisos/proveedores                    | AC-006: claim/admisión atómicos y cerrados; una cuenta no reclama otra        |

Objetivo: aceptación por Gmail y estado visible en aproximadamente 2–5 s en condiciones normales; no es promesa de entrega al destinatario. Adjuntos grandes, cuotas agotadas, proveedor lento/caído, cuenta desconectada y resultados inciertos pueden superar ese objetivo. No se suben límites ni se relajan permisos.

No aplica: modelo de negocio nuevo, cuentas/OAuth nuevos, datos de clientes en fixtures, nuevo servicio externo, esquema expuesto sin RLS.
