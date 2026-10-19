# Campañas y plantillas del sistema

Aplicar `supabase/migrations/039_campaign_delivery_controls.sql` después de las migraciones anteriores, antes de desplegar la web y el trabajador nuevos. No se requieren permisos OAuth nuevos: se conservan `gmail.readonly` y `gmail.send`.

## Uso

1. Preparar y verificar leads. Solo `verification='valid'` permite inscribirlos.
2. En **Campañas → Plantillas**, crear una plantilla con asunto, mensaje, variables y hasta cinco adjuntos generales (15 MB en total; cada archivo hasta 10 MB). El formato básico admite negritas, cursivas, listas y enlaces HTTP/HTTPS mediante los botones del editor. El HTML introducido como texto no se ejecuta.
3. Agregar los seguimientos opcionales y guardar. Cada mensaje debe incluir `{{unsubscribe_url}}`. Se pueden duplicar, archivar y restaurar plantillas. El historial conserva las versiones existentes desde la migración y cada edición posterior.
4. Crear una campaña seleccionando una plantilla del sistema, cuenta autorizada, lote (o todos los leads disponibles), responsable, horario y máximo por 24 h. El contenido y los adjuntos quedan congelados al crear el borrador; editar o archivar después la plantilla no modifica campañas existentes.
5. Abrir **Audiencia y vista previa**. Revisar los datos reales, motivos de exclusión y todos los mensajes de la secuencia. Corregir los datos faltantes en el cliente o marcarlo como excluido y guardar las exclusiones. La activación vuelve a validar la audiencia completa en la base de datos.
6. **Enviar prueba a mi correo** encola el mensaje inicial y sus adjuntos para el usuario autenticado. Nunca lo dirige al lead. Los enlaces son ilustrativos; los seguimientos se revisan en pantalla. Las pruebas consumen el presupuesto total de la cuenta y no cambian etapas, conversaciones ni secuencias del cliente. Demo nunca envía.
7. Activar y observar aceptados por Gmail, pendientes, respuestas, fallidos y por revisar. La aceptación de Gmail no es evidencia de entrega o lectura.

Los administradores de ventas y superadministradores administran campañas; se exige permiso sobre la cuenta remitente. El superadministrador configura los límites en **Configuración → Integraciones → Límites de envío**.

## Controles de envío

- Ventana móvil de 24 horas, compartida entre todas las campañas y operaciones de la misma cuenta. Se incluyen reservas en estado `sending`, aceptados y resultados inciertos para evitar sobreasignación entre trabajadores.
- Cupo de campañas predeterminado de 100 y reserva operativa de 20. El límite total existente de cada cuenta se conserva: si es 100, quedan como máximo 80 para campañas. Para habilitar 100 de campaña más 20 de reserva, configurar un total de al menos 120. Estos son presupuestos del CRM, no una promesa de capacidad de Google.
- Techo conservador adicional de 2.000 destinatarios acumulados por 24 h, contando To/Cc/Bcc y repeticiones, incluso destinatarios internos. Puede ser más restrictivo que Workspace y evita consumir todos sus límites de destinatarios. Las campañas envían un correo por cliente.
- Trabajos `gmail_sending_usage` consultan periódicamente la carpeta Enviados de cada cuenta conectada, incluidos los envíos fuera del CRM. Se procesan páginas de 50 mensajes y se conservan ID, fecha, Message-ID y cantidad de destinatarios; no cuerpos. Se evitan duplicados con outbox. Solo se marca una consulta completa al terminar todas sus páginas.
- Las campañas esperan a una consulta completa y se detienen si tiene más de 15 minutos. El panel muestra su fecha. Los mensajes eliminados o retirados de Enviados antes de la consulta no pueden reconstruirse; el uso observado no es un contador oficial de cuota restante de Google. Mantener margen operativo.
- El presupuesto de API se reserva en Postgres entre web y trabajadores: 4.500 unidades/minuto por cuenta y 900.000 por proyecto, con los costos actuales (lecturas full/raw/html de 60 unidades, envío de 100). `projectId` opcional en cada entrada de `GOOGLE_OAUTH_ORGANIZATIONS` identifica el proyecto compartido; si se omite se usa el número del proyecto del client ID de Google. Las organizaciones que compartan un proyecto deben usar el mismo identificador.
- Techo interno de 75 millones de unidades por proyecto en 24 horas, con margen respecto al umbral estándar publicado de 80 millones. Al alcanzarlo se difieren las operaciones; el CRM no solicita aumentos ni habilita facturación. Confirmar las cuotas efectivas y los cambios de Google en Cloud Console.
- Un último control después de preparar adjuntos y reservar API comprueba autorización, bajas, verificación, objetivo, horario, estado de campaña y cuenta, frescura y cupos antes del POST a Gmail.
- Los rechazos de cuota confirmados respetan Retry-After. Los resultados inciertos conservan su Message-ID y pasan por conciliación; no se repite a ciegas un envío. Respuestas, bajas, rebotes permanentes, traspaso y objetivos detienen los seguimientos correspondientes.

## Validación antes del piloto

Ejecutar typecheck, build y las pruebas, en particular `campaign-delivery.test.ts`, `campaign-templates.test.ts`, `campaign-attachments.test.ts`, `gmail-sending-usage.test.ts`, `gmail-recovery.test.ts` y `mail-send.test.ts`. No necesitan cuentas ni envíos reales.

En el despliegue, verificar la migración, el trabajador, permisos del remitente, una consulta completa de Enviados y la configuración de límites. Realizar después un piloto con destinatarios internos. Las campañas existentes conservan su contenido y estado; la migración no activa campañas.

Referencias: [cuotas de Gmail API](https://developers.google.com/workspace/gmail/api/reference/quota), [límites de Workspace](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace?hl=en), [manejo de errores](https://developers.google.com/workspace/gmail/api/guides/handle-errors).
