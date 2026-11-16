# MP-PERF01 · Paginación del archivo bajo RLS

Hallazgo del postflight real: el GET devuelve datos válidos, pero cambiar de pestaña deja la interfaz en carga durante demasiado tiempo. Las observaciones de navegador expiraron antes de recibir la navegación; una lectura posterior de la misma petición comprobó la respuesta. La vista de archivo usa una función SQL security definer SETOF que devuelve m.*: cada página y su exact-count vuelven a recorrer/materializar el archivo antes de filtrar el período.

Hipótesis contrastadas: (1) fallo de sesión/permisos, descartado por el GET real correcto, el control anónimo401 y los catálogos; (2) error JS, sin errores de consola; (3) trabajo repetido al paginar la vista, confirmado por su definición y el alcance8215 mensajes del período. La nueva lectura directa sigue usando el cliente del usuario y SELECT explícito de nueve metadatos, sin encrypted_payload.

Antes de cambiar código, una consulta READ ONLY bajo rol authenticated/contexto del superadmin verificado confirmó: RLS activo en gmail_archive_messages, grants existentes para las nueve columnas, política gmail_admin_read exclusivamente current_app_role()=superadmin y mismos conteos en tabla/vista en el mismo snapshot. Evidencia: evidence/archive-direct-preflight.json. No se modificó SQL ni se concedió ningún permiso.

Diseño del ajuste: únicamente para profile.role=superadmin, leer esos metadatos en gmail_archive_messages con páginas solicitadas de1000; el lector sigue el cap real del servidor y verifica el count de cada página. Los otros roles conservan mail_archive_visible y páginas500, con sus mismos filtros de área/evidencia. Las reglas, métricas, límites, cuerpos y cifrado no cambian.

Verificación necesaria: regresión SDK que prueba tres registros bajo cap2 sin perder filas, página1000 y ausencia de payload; seller nunca consulta la tabla directa. Repetir las pruebas integradas/build y validar el nuevo GET/pestañas con la sesión real después del despliegue del ajuste. No se atribuye al timing del navegador una medición exacta del tiempo de servidor.
