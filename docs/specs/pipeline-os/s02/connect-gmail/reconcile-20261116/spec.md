# Conciliación de conexión existente — STRICT

Autorización 16/11/2026: implementar la conciliación del intento vencido y publicar los cambios en producción. Incluye el parche de compatibilidad ya probado. Clarificación cerrada por el alcance explícito y los contratos existentes: mismo superadmin activo con MFA, Gmail/marca originales, cero nuevos enlaces y cero activación de transporte. Se usará producción CRM/Supabase/Coolify ya identificada; no se cambia infraestructura ni configuración viva.

| FR / AC | Resultado |
|---|---|
| R01 / A01 | Revisar intentos propios vencidos con conexión y sin identidad/binding admitidos; no aceptar conexión, correo, owner o marca nuevos del navegador. |
| R02 / A02 | Crear una conciliación independiente con sesión actual, plazo propio, clave idempotente, CAS y evidencia del origen. Normalizar solo el estado del origen a expired si aún figura prepared; conservar fechas, conexión y fases, nunca ampliar TTL. |
| R03 / A03 | Dos GET de metadata y un GET de perfil vía proxy como máximo por conciliación, sin retries ni createLink. Reserva/admisión Gmail propias ligadas a política compartida vigente. |
| R04 / A04 | Comprobar tuple, OAuth habilitado, Gmail ACTIVE, correo exacto; materializar solo después de verificar. La continuación usa una revisión nueva ligada al origen y los controles existentes de marca/registro. |
| R05 / A05 | Doble solicitud y callback viejo no duplican llamadas/cuentas; resultado incompleto queda visible y requiere revisión, sin retry automático. Ningún transporte, permiso de correo o envío se activa. |
| R06 / A06 | Probar localmente éxito, permisos, origen, caducidad, drift, cuota y duplicación; respaldo verificado antes de SQL aditivo, postflight ACL/RLS y despliegue Linux saludable. |

ADR: ledger privado independiente para conciliación, concesiones humanas de un solo uso y continuación nueva sin callback OAuth. No se reabre la fase/capacidad original ni se altera el contrato de los RPC existentes. La nueva continuación conserva el flujo humano de marca/candidato. Reversa: deshabilitar uso de la UI mediante rollback del código; no borrar ledger con evidencia. SQL de retirada solo antes de uso y probado en local.

T01 SQL/ACL/cuota y reversa; T02 servicio/HTTP; T03 UI; T04 pruebas; T05 respaldo/preflight SQL; T06 integración y publicación; T07 postflight y verificación humana. Todo efecto real y resultado se registra en verification.md. Los cambios productivos necesarios dentro de este alcance están autorizados; no se reutilizan presupuestos de intentos anteriores.
