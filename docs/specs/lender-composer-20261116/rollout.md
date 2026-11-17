# Rollout y rollback

Entrega actual local, sin push, merge, migración remota ni publicación. Antes de publicar: revisar head compartido, conflictos y número de migración, backup restringido, probar SQL forward/reversa en PG15, validar roles y checklist con fixtures y obtener autorización del entorno/objetivo.

Orden futuro: migración compatible primero, código después, smoke read-only en producción. No ejecutar envíos de prueba reales. Conservar worker y cuotas vigentes.

Rollback: volver al código anterior y restaurar definiciones SQL respaldadas en la misma sesión de despliegue; no borrar plantillas/versiones. Conservar selecciones grandes aunque UI antigua limite nuevas selecciones. Los mensajes ya encolados son operaciones independientes y no deben eliminarse automáticamente. Guardar evidencia sin datos personales ni credenciales.
