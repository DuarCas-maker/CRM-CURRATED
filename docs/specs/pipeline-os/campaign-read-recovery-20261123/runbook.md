# Publicación

Destino autorizado del módulo: crm.finlabinc.com y Supabase autoalojado supabase.finlabinc.com. Esta corrección continúa el alcance publicado; no aumenta permisos, timeouts ni consumo externo.

1. Conciliar funciones productivas contra baseline, probar candidato/reversa localmente con datos ficticios y revisar resultados exactos y roles.
2. Crear respaldo custom y comprobar listado, decodificación y huella. Conservar definiciones y atributos originales para reversa puntual.
3. Aplicar SQL transaccional con CAS de hashes de origen y comprobación de atributos originales. Cancelar ante drift. No reiniciar servicios ni aplicar otras migraciones pendientes.
4. Leer overview desde sesión CRM real, comprobar conteos/paginación, abrir detalle y tarjetas; verificar datos Bouncer preservados. Registrar tiempo observado y comparación con 8 segundos.
5. Publicar solo SQL, pruebas y documentación propios por el mecanismo existente. Si no cambia TypeScript/Next, no es necesaria una modificación de frontend ni variables.

Rollback: restaurar únicamente las funciones originales mediante rollback.sql, verificando primero hashes del candidato. Eliminar el helper privado nuevo. Ninguna reversa de datos, campañas, credenciales ni resultados Bouncer.
