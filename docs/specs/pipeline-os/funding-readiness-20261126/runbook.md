# Publicación y reversa

1. Captura acotada de catálogo/cantidades, sin exportar clientes a Git ni logs.
2. Ensayar SQL/roles/compatibilidad en PGlite y PostgreSQL temporal local; HTTP, frontend, TypeScript y build.
3. Respaldo reciente listado/decodificado y comparación de hashes del catálogo. Instalar solo las RPC de lectura; sin backfill ni cambios de datos.
4. Publicar app y verificar desde sesión humana con MFA, sin pulsar Enviar campaña. Revisar conteos y faltantes.
5. Reversa: restaurar versión anterior de app; retirar solo estas RPC después de descartar llamadas activas. Los datos de ingresos, validaciones, campañas y recordatorios no cambian.
