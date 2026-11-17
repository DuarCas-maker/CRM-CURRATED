# Publicación autorizada — 17/11/2026

El usuario autoriza: «integra, aplica la migración y publica cambios». Alcance: candidato b7c649e sobre main a881100, Curated `https://crm.finlabinc.com` y Supabase `https://supabase.finlabinc.com`, PostgreSQL postgres/supabase_admin. Mantener los límites de no importar datos reales ni enviar correos en las pruebas. No configurar proveedores, campañas, credenciales ni modo del worker.

1. Fetch de main y comprobar ancestry/árbol limpio del worktree aislado. No actualizar por fuerza el checkout coordinador ni incluir su WIP. Resultado: main continúa en a881100; candidato descendiente directo, sin conflictos.
2. Preflight productivo de solo lectura: destino/rol/PG15, 055 presente, 056 ausente, huellas/ACL de las dos funciones y constraint, fuentes/áreas intactas. Guardar únicamente metadatos.
3. Respaldo completo en volumen persistente de BD, directorio 700/archivo 600; verificar lista y decodificación completa con pg_restore y SHA256. No descargar filas. Esta verificación no equivale a una restauración integral ni a un backup fuera del VPS.
4. Aplicar exactamente `supabase/migrations/056_lender_composer.sql` con huella registrada, bloqueo/timeout acotados y comprobación de drift respecto al preflight dentro de la transacción. No repetir una aplicación ante timeout sin inspeccionar.
5. Postflight: RLS/roles, tablas/versiones/RPC, eliminación del tope 20 y persistencia de guardas de fuentes/área. Comparar huella del catálogo ajeno y `can_send`, y ACL de las colas.
   Ajuste observado: defaults productivos de Supabase otorgan DML a API roles. Aplicar 057 de ACL mínima para las dos tablas nuevas; se ensayó PG15 con esos mismos defaults. Mantener 056 ya aplicada intacta. Ver bugfix.md.
6. Smoke SQL de plantillas, versión, idempotencia, archivo, selección de 73 y MFA/RLS con fixtures en ROLLBACK, sin tocar outbox. Confirmar que no persisten las filas ficticias. El contexto SQL temporal no es una sesión JWT humana.
7. Integrar por push fast-forward a main desde el worktree autorizado, sin force. Releer main justo antes; si avanzó, incorporar y verificar el delta antes de publicar. El mecanismo existente despliega por push: no iniciar redeploy duplicado.
8. Esperar despliegue web y comprobar health, endpoints nuevos y guardas 401/403/400 esperadas; no enviar mensajes. Con sesión real existente, abrir Plantillas y revisar Nuevo correo sin guardar cambios reales ni revisar la marca (evitar consultas a proveedor). Capturas solo sin datos de clientes. Si no hay sesión, documentar el límite y completar checks HTTP/SQL.

Checks previos del candidato: 62 pruebas únicas, PG15 sobre payload aceptado 049 + 055, typecheck/build y visual 360/768/1280 correctos. Sin cambios de producto desde esa verificación. El instalador operativo se ensaya con el smoke SQL en PG15 antes de aplicar.

El avance concurrente 2c077cc de campañas se incorporará preservando su panel y controles. No se vuelve a aplicar su DDL, que pertenece a ese frente.

Rollback: preferir volver a web a881100 conservando 056 aditiva. Si fuera imprescindible restaurar funciones, usar `rollback.sql`, que restaura las definiciones respaldadas y conserva tablas/versiones/selecciones. No borrar outbox ni datos. No restaurar toda la BD sobre actividad concurrente. Todo fallo detiene el avance; no publicar sobre migración o respaldo sin verificar.
