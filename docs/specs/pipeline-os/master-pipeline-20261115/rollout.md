# Integración y recuperación propuestas

Estado: candidato local probado, sin autorización de publicación para Master Pipeline. La autorización histórica de Connect no se transfiere a esta funcionalidad.

Actualización de la continuación: el usuario autorizó integrar y validar las lecturas antes de publicar. Esa integración y su evidencia se registran en integration-result.md. La base final conciliada es70c1efb y el runbook concreto de promoción/recuperación es publication-runbook.md. Los pasos de preparación siguientes se conservan como antecedente del candidato.

1. Revisar `master-pipeline.patch`, `implementation-manifest.json` y `verification.md`. El parche contiene exactamente 13 archivos de aplicación/pruebas; la documentación y las capturas acompañan la revisión y no forman parte de ese parche.
2. Verificar nuevamente HEAD, WIP y hashes de los dos archivos existentes en el checkout destino. Si hay cambios en esas rutas, conciliar el diff sin reset/stash/revert de trabajo ajeno. El último `git apply --check` contra `01b6d3f` pasó y no aplicó nada. Esa base ya incluye el checklist y la recuperación Connect; se preservan ambos.
3. Integrar únicamente el alcance revisado en una rama propia cuando se autorice esa transferencia. Ejecutar los checks indicados en verification.md. No incluir secretos, snapshots `.local`, datasets HTML ni otros WIP.
4. Antes de publicar, confirmar mediante las herramientas autorizadas que las vistas/tablas/columnas existentes del lector están disponibles con sesión y MFA. Las vistas de correo existentes y la053 son capacidades requeridas; si falta alguna, detener esa promoción y preparar un delta separado. Este candidato no instala SQL.
5. Push, publicación e infraestructura requieren autorización concreta según AGENTS.md. Preparar build del entorno destino y smoke de los roles reales autorizados: entrada Master, tabla por asesor, seis pestañas, expediente/correo, ausencia de importes fuera del área y lectura sin mutaciones.

Recuperación: publicar de nuevo la versión anterior de la aplicación o revertir únicamente los 13 archivos del cambio revisado. No hay migración ni datos escritos que revertir. Conservar cualquier cambio posterior ajeno al candidato. Si falla el lector, la vista muestra error; Tareas/Indicadores anteriores siguen disponibles.

No se ha ejecutado ninguno de los pasos de integración, push o publicación de esta lista. La preparación deja el resultado concreto para su revisión.
