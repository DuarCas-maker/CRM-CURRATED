# Publicación del arreglo de cuentas heredadas Gmail

Continuación del alcance automático Gmail autorizado por el usuario. Destino https://crm.finlabinc.com, Coolify 4.7.5, proyecto gzbzm9radjjsrbgtufhi7x53 / production xldygmbiax9prff0pgldqu5a. Web rv8rpfxhf0mbxprge6h6ki9c, worker vc4aybj4ucje7zstpsp3zboh. Base de reversa ac4dd12. No migración, cambio de variables ni compras; Composio cerrado. La omisión de backup nuevo fue indicada expresamente por el usuario en esta entrega; el parche solo cambia código.

1. Revisar el diff, checks y main antes del push; incorporar avances compatibles sin descartar WIP.
2. Commit y push normal HEAD:main. El webhook existente publica web y worker; no reiniciar bases ni cambiar configuración.
3. Acreditar Success y Running con el mismo commit en ambos recursos y /api/health ok. Si falla, revisar log y corregir antes de continuar; no afirmar publicación por el push.
4. Desde la sesión CRM legítima, refrescar Conexiones y volver a intentar el correo indicado conservando su responsable. Confirmar que la fila heredada conserva ID, se registra el intento y el flujo llega a Google. Detenerse antes de aceptar permisos; ese consentimiento corresponde al usuario. No enviar mensajes ni reactivar campañas.
5. Guardar postflight sin emails, secretos o datos de clientes en el repo. Capturas reales privadas excluidas del commit.

Reversa ante regresión: redeploy ac4dd12 conservando revisiones, auditoría e intentos ya registrados. No borrar datos ni retirar una revisión confirmada para ocultar el fallo. No se necesita rollback SQL. Las autorizaciones Google posteriores se conservan.
