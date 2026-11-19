# Verificación

40 pruebas pasan, cero fallos: contenidos, presets/MIME, versiones, campañas/worker, API y cuotas. Fachada Gmail real probada con SDK y red ficticios: sesión/MFA/origen/rol, permiso revocado antes del SDK y durante espera, cambio de cuenta/ruta, reserva/admisión y solo GET del recurso fijo. El MIME incluye una sola firma del remitente en cada recordatorio. Las pruebas no llaman proveedores reales.

TypeScript sin errores y build webpack final correcto. Webpack se usa únicamente por la unión local de node_modules; configuración del despliegue conservada.

Ensayo nativo PostgreSQL15.19: permisos anon/service_role denegados, administrador ajeno y MFA insuficiente rechazados, marca obsoleta, revisión de ruta, historial, contenido idempotente, campaña anterior intacta y reversa con rechazo de versión modificada. native-result.json fija hashes exactos. Tablas privadas de rutas/health son dobles estructurales, no un ensayo completo Auth/PostgREST. El primer ensayo nativo detectó que el adaptador de tests no persistía SET ROLE anon entre conexiones; se añadió ese rol al adaptador y se repitió sin relajar la expectativa.

UI local: guardar R2 editado, reabrirlo y cargarlo en una nueva campaña; cambiar entre dos remitentes y observar firmas distintas. Vista a1280/768/360 y navegación Tab cuenta→plantilla verificadas. Capturas con datos ficticios. Ninguna campaña real creada por el agente; el harness carece de worker/proveedores.

Revisión: contenido comercial fuera de :::signature conservado, bajas preservadas, intervalos2/3/3/5 y snapshots anteriores intactos. Firma HTML limitada a iframe sandbox con CSP sin red/scripts; sin inserción en DOM principal. Pérdida del permiso o cambio de contexto detiene la consulta antes de wire. Controles de envío existentes intactos; la consulta de preview nunca envía.

Producción SQL19/11 02:36:46Z: respaldo de67.490.945 bytes, listado y decodificación verificados (sin ensayo completo de recuperación de desastre); una función pública añadida, cero funciones existentes cambiadas; journal privado RLS. Dos plantillas pasan de v1/0 recordatorios/firma fija a v2/4 recordatorios/sin firma fija. Historial anterior conservado y hash de snapshots de campañas idéntico. Ver sql-application.json y backup.json.

Pendiente: confirmar recursos y API después de publicar web.
