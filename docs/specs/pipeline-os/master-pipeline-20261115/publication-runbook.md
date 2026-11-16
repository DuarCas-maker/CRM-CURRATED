# Promoción concreta de Master Pipeline

Estado: integración local y preflight de lecturas terminados; push/despliegue aún no ejecutados. La instrucción recibida pide integrar y validar antes de publicar. Este documento delimita la promoción para la aprobación productiva exigida por AGENTS.md.

## Destino y alcance

- CRM existente `https://crm.finlabinc.com`, repositorio `DuarCas-maker/CRM-CURRATED`, rama remota `main`.
- Coolify web `rv8rpfxhf0mbxprge6h6ki9c`. Base previa `70c1efb65f541d53fcaca7ea7a37c967c54afa46`. La rama de integración contiene únicamente los13 archivos de Master y su documentación/evidencia pública; conserva el cambio same-origin de esa base.
- Ninguna migración, instalación de dependencias, cambio de env, secreto, rol, transporte, worker o envío. El build usa Dockerfile/healthcheck existentes, Node22, usuario no-root y puerto3000. No se afirma un build Docker local; el build Linux de Coolify es un control posterior de esta promoción.
- Los metadatos y conteos de preflight no respaldan una restauración de datos. No hay escrituras de negocio de Master que requieran backfill o reversa SQL.

## Ejecución propuesta tras aprobación

1. Verificar el commit sellado, sus13 huellas, índice limpio y remoto todavía en la base esperada. Si main avanzó, conciliar ese delta y repetir los checks afectados; no force push ni reset.
2. `git push origin <commit-integrado>:refs/heads/main`, fast-forward. El commit exacto quedará registrado en la evidencia de promoción.
3. Esperar el webhook existente de Coolify. Comprobar build Linux, commit exacto, web saludable y rolling update terminado. No repetir deploy si el webhook ya está activo; redeploy manual solo si se demuestra que no se entregó.
4. El webhook podría reconstruir también el worker por la configuración compartida ya existente. Conservar su modo normal; no cambiar variables/modos, iniciar pilotos, reintentar jobs ni realizar acciones de proveedores. Verificar su salud si Coolify lo reconstruye automáticamente.
5. Smoke anónimo real: `/api/health`200 y nuevo GET de Master sin sesión401 con no-store. Filtros inválidos400 sin ejecutar lecturas de negocio.
6. Con la sesión real del superadmin y MFA: leer el nuevo GET y las seis pestañas, comprobar tabla/asesor, etapa, búsqueda, vacíos legítimos, apertura de expediente y lector de correo existente. Solo lecturas; no guardar, analizar con IA, generar OAuth, completar tareas, importar ni enviar. Comparar agregados con fuentes dentro de la misma ventana de observación; el reporte no es una transacción entre tablas.
7. Registrar resultados, errores de consola pertinentes y limitaciones. Capturas públicas con demo o región que no exponga clientes. Confirmar que el commit esperado llegó al recurso web. Actualizar documentación de publicación.

## Criterios de detención y recuperación

Detener la promoción ante deriva de fuentes, fallo de permisos, ausencia de sesión MFA, build/health fallido o exposición de datos fuera del alcance. No ampliar permisos ni aplicar SQL para ocultar un fallo de lectura.

Recuperación web: volver a la imagen/versión70c1efb mediante Coolify. Si se requiere una corrección en Git, revertir únicamente este delta en un commit posterior. Conservar datos, env y worker actuales y cualquier cambio ajeno posterior. No restaurar íntegramente la base, borrar volúmenes ni ejecutar force push.
