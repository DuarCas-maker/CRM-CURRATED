# Publicación propuesta

Publicar el arreglo de parse-import.ts y su regresión, más esta evidencia, en crm.finlabinc.com sobre main vigente. Requiere aprobación explícita según AGENTS.md. Ninguna migración ni cambio de datos/env/infraestructura está incluido.

1. Confirmar main=base2ef0826 o conciliar cambios posteriores sin sobrescribir WIP. Verificar blobs/hashes del manifiesto y51 pruebas/tipos/build. El coordinador conserva su rama y cambios propios; publicar desde worktree aislado.
2. Commit y push solo de los dos archivos de código/prueba y este paquete documental. El webhook vigente de Coolify reconstruye web y worker: ambos consumen el parser común corregido. Mantener WORKER_EXECUTION_MODE=normal y el flag de correo manual existentes; no editar configuración ni reiniciar Supabase.
3. Comprobar éxito de despliegue, imagen/commit y salud de ambos servicios. HTTP GET health y denegación sin sesión. Recargar la pestaña que muestra el error para cargar la nueva versión.
4. Smoke con XLSX ficticio de texto enriquecido: solo vista previa, sin confirmar registro en producción. No volver a subir/registrar el Excel real del usuario, aprobar Bouncer, crear/activar campañas o enviar mensajes como parte del smoke.
5. Registrar evidencia y estado final, dejando al usuario confirmar su importación real y sus aprobaciones posteriores.

Reversa: revertir solo el commit del hotfix y publicar por el mecanismo vigente, conservando releases posteriores. No borrar/reprocesar importaciones ni modificar contactos. No hay reversa SQL. Cualquier reparación de datos reales sería un alcance separado.
