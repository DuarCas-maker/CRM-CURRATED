# Revisión previa a integración

Alcance: importación y consentimiento, pool, campaña nueva por lotes, secuencia, lectores de Pipeline y worker. No dependencias, configuración o credenciales nuevas. No cambios en lenders/F1, Composio, Auth, cuotas o infraestructura.

Hallazgos corregidos y comprobados:

- La reanudación genérica podía descubrir audiencia adicional: el flujo nuevo solo reanuda sus enrollments congelados y conserva estados terminales.
- Al dejar de ser first_contact, una reprogramación necesitaba repetir la fecha en la admisión: ahora también valida fecha/paso y contacto previo antes del primer correo.
- La fecha de recordatorios debe salir de la confirmación real y del calendario civil: trigger limitado a flujos nuevos, calendario 2/3/3/5 y desplazamiento de domingos; incertidumbre no se reintenta.
- Una respuesta a un recordatorio puede estar en otro hilo: las lecturas nuevas usan todos los pasos aceptados, mismas pruebas RFC/cuenta/destinatario/tiempo y abren la conversación correcta. Campañas anteriores delegan al lector conservado.
- La activación heredada cambia el responsable: el lanzamiento restituye cada asesor y owner_locked_at dentro de la misma transacción.
- Las preparaciones internas no son todavía Documentos: proyección separada, preservando casos con actividad/evidencia y las reglas documentales vigentes.
- RLS no debe invocar directamente un helper privado sin EXECUTE: helper público booleano, SECURITY DEFINER y sin ampliación de datos; escrituras de cliente bloqueadas.

121 pruebas pasan; ensayo nativo PostgreSQL15 con concurrencia y reversa. Build y TypeScript pasan. Proveedores ficticios en QA; producción aún sin comandos de campaña/verificación de este incremento.

Límites: Docker local no disponible; build real/health remoto se comprueban durante publicación. El respaldo se listó y decodificó, sin ensayo completo de recuperación de desastre. La interfaz Coolify quedó sin completar carga; el SQL/respaldo usaron la API administrativa ya conectada. La revisión visual cubrió móvil360 y tablet768 efectivos, escritorio previo de1163px; el intento final de1280 quedó limitado por el panel del navegador a785px. No se declara comprobación visual exacta1280.
