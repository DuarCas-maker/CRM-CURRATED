# Publicación y recuperación

Autorización explícita del usuario: publicar el arreglo en producción y recuperar resultados existentes de 502 leads sin repetir consumo. Base revisada: origin/main 8f8c19f, mismo worker que producción. WIP ajeno conservado.

1. Ejecutar pruebas offline de guardado y regresión de verificación; TypeScript. Docker no está disponible localmente: comprobar build del Dockerfile.worker en Coolify y no afirmar una prueba Docker local.
2. Revisar y commitear solo worker/bouncer.ts, su test nuevo y esta carpeta. Publicar por el mecanismo existente; verificar commit, despliegue correcto y worker saludable. Sin variables nuevas ni migración.
3. Identificar por lectura el lote ya creado. Descargar y validar los resultados contra las reservas exactas. Nunca ejecutar startScrub para recuperar este incidente.
4. Crear respaldo custom en volumen PostgreSQL y verificar listado, decodificación y SHA-256. No exportar sus datos al repositorio.
5. Asociar solo filas de la cohorte aprobada que sigan inciertas sin lote; aplicar resultados mediante la función existente en transacción con comprobaciones previas. Cancelar todo si cambia el conjunto.
6. Comprobar 502 resultados, estados finales, conservación de los errores 402 ajenos y salud del worker/CRM. Registrar evidencia agregada.

Rollback de código: desplegar la revisión anterior mediante Coolify, sin reset del checkout. No devolver verificaciones recuperadas a queued ni repetir el POST. Si la conciliación falla antes de commit, rollback de la transacción. Después de commit, conservar los resultados del proveedor; una corrección posterior requiere revisar el respaldo y el registro acotado, sin restaurar toda producción ni deshacer resultados válidos automáticamente.
