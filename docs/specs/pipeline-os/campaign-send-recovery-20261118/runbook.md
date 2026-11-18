# Promoción

Destino: crm.finlabinc.com, worker Coolify vc4aybj4ucje7zstpsp3zboh, web rv8rpfxhf0mbxprge6h6ki9c, Supabase autoalojado supabase.finlabinc.com. Rama main por push no forzado sobre origen conciliado. La conexión SQL administrativa existente se mantiene en memoria, sin abrir .env ni mostrar claves.

1. Pruebas offline y TypeScript/build. T01 solo conserva códigos seguros; no modifica ejecución o reintentos.
2. Publicar T01 y comprobar el código de la próxima tarea normal por SELECT READ ONLY. Si el código no confirma la hipótesis, adaptar el diseño antes de corregir.
3. T02/T03: publicar la corrección probada. SQL nuevo solo si se demuestra necesario, con ensayo y respaldo reciente previo; no hay autorización para cambios de infraestructura o credenciales ajenos.
4. Observar avance de external_usage_synced_at, tareas completadas y pendientes/enviados de la campaña. No invocar claim/send/finish/manipular el uso desde el agente.
5. Reversa de código:95114ab para T01; registrar la versión anterior exacta para T02. Conservar cola, recibos e historial; no reenviar mensajes inciertos. Parar promoción ante deriva de contrato o fallas de permisos.

No se declaran completados los envíos por tener un build verde. El cierre exige evidencia productiva o una limitación concreta documentada.
