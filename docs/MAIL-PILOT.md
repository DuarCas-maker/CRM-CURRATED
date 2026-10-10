# Primera prueba de correo Gmail

## Activar esta etapa

1. Hacer respaldo de Supabase y ejecutar **solo** `supabase/migrations/016_manual_email.sql` en SQL Editor, como `postgres`. Las migraciones 009–015 ya instaladas no se repiten. No usar el instalador completo.
2. Después de confirmar la migración, publicar el código y desplegar la web y `curated-worker`, de uno en uno. Esta etapa no requiere variables nuevas ni cambiar las claves OAuth.
3. Mantener `GMAIL_HISTORY_ENABLED=true`, `GMAIL_SYNC_MODE=polling` y las credenciales existentes en ambos recursos.

## Prueba controlada

1. En Configuración → Permisos de remitentes, comprobar que el usuario tenga permiso para la cuenta conectada. La selección del responsable de una cuenta es independiente de este permiso.
2. Abrir una oportunidad existente en la que el usuario pueda trabajar. También hay acceso a Nuevo correo desde Oportunidades y Conversaciones; allí la selección muestra los expedientes cargados en la página actual.
3. Pulsar **Nuevo correo**. Elegir la cuenta, verificar la oportunidad y poner un buzón propio en **Para**. Esto no cambia el contacto principal ni crea un cliente con esa dirección: la asociación a este expediente es una decisión explícita del usuario.
4. Usar asunto `Prueba Gmail CRM` y mensaje `Este es un correo de prueba enviado desde el CRM. Por favor responde a este mismo hilo.` Enviar únicamente ese mensaje de prueba, inicialmente sin adjuntos.
5. Abrir Correo e histórico del expediente o Conversaciones. Consultar **Estado de envíos**: En cola → Enviando → Aceptado por Gmail. La aceptación por la API no garantiza entrega: verificar que aparezca en Enviados de Gmail y llegue al buzón de prueba.
6. Responder desde ese buzón. La sincronización general de cuentas con histórico se activa después de **confirmar y completar la importación**, no simplemente al autorizar OAuth. Si el análisis anual sigue pendiente, comprobar primero el envío y la respuesta en Gmail; terminar la importación controlada antes de exigir que la respuesta aparezca automáticamente en el CRM.
7. Tras activar sincronización, comprobar que la respuesta aparezca una sola vez en Conversaciones, dentro del mismo expediente. Responder desde el CRM a ese hilo y verificar que se mantengan asunto, destinatario y relación con la oportunidad.
8. Repetir con un documento ficticio aprobado del expediente. Los documentos importados no se aprueban automáticamente. No adjuntar documentación real de clientes al buzón de prueba.

## Recuperación y límites

- Un rechazo explícito de cuota 403/429 conserva la cuenta conectada y vuelve a poner el mensaje en cola. Se usa espera progresiva, con máximo de una hora para la espera calculada; un `Retry-After` mayor de Google siempre prevalece. La espera se guarda por cuenta y también afecta mensajes nuevos y notificaciones.
- Un timeout o un fallo al registrar la aceptación deja el resultado incierto. El worker busca el Message-ID en Enviados y no vuelve a enviar automáticamente ese POST. Revisar el envío antes de cualquier intento manual.
- Un error real de autorización o política del dominio sigue requiriendo intervención. No se confunde con una cuota temporal.
- Los leads nuevos siguen requiriendo validación antes de ser oportunidades. Un expediente histórico aprobado puede enviar manualmente sin lanzar Bouncer; las campañas conservan sus requisitos de validación.

## Verificación local y límites del piloto

Las pruebas usan PGlite, OAuth/Gmail simulados y datos ficticios: verifican permisos/MFA, deduplicación, adjuntos ajenos/no aprobados, espera persistente por cuenta, excepción histórica, traspaso, destinatario del hilo y ausencia de repetición ante resultado incierto. No envían correos reales ni consumen Bouncer.
La recepción real, la continuidad del hilo y la entrega de adjuntos deben confirmarse con el piloto anterior en Coolify. Esta etapa no incorpora IA ni análisis financiero automático.
