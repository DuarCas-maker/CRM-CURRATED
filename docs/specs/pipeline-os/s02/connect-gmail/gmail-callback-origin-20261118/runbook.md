# Corrección del regreso Gmail — producción

Continuación de la publicación Gmail autorizada por el usuario y documentada en ../simple-mail-20261117/release-gmail-direct/runbook.md. La solicitud actual reporta el fallo de ese mismo flujo. No hay cambio de alcance de permisos, proveedor, SQL, infraestructura o compras. Composio permanece cerrado. Backup nuevo omitido expresamente por el usuario en la publicación original; este parche solo cambia código.

Destino: https://crm.finlabinc.com. Coolify 4.7.5, proyecto gzbzm9radjjsrbgtufhi7x53, entorno xldygmbiax9prff0pgldqu5a; web rv8rpfxhf0mbxprge6h6ki9c y worker vc4aybj4ucje7zstpsp3zboh. Pipeline existente por push normal a main. APP_ORIGIN existente ya es la URL pública y no requiere modificación. Callback Google registrado conservado.

## Secuencia

1. Incorporar avances compatibles de main sin descartar WIP. Base inicial b1d87c4; avance c250fea incorporado por fast-forward antes de publicar. Repetir checks afectados por este avance de campañas/google/worker.
2. Revisar diff: production.ts usa helper validado; helper rechaza configuración inválida; pruebas de regresión del destino. No se modifica cookie, sesión, MFA, PKCE ni intercambio OAuth. Lecturas administrativas limitadas a metadata booleana, archivos privados excluidos de git.
3. Commit del parche y documentación; comprobar main otra vez y push no forzado HEAD:main. No aplicar SQL ni cambiar flags.
4. Seguir despliegues web/worker en Coolify; registrar commit, estado y salud. Verificar /api/health público y cierre de rutas sin sesión. Si no hay acceso para acreditar un despliegue, consignar esa limitación, nunca declarar éxito por el push.
5. Regreso público validado localmente y recuperación del intento real con la sesión original. No solicitar un nuevo consentimiento para probar el arreglo, ni reutilizar códigos OAuth. No enviar correos ni reactivar campañas.

## Criterios y reversa

Éxito: regresión/types/build aprobados, publicación confirmada y salud, destino público sin parámetros OAuth, intento reportado ready sin volver a Google. La sincronización histórica tiene su estado propio y no se presenta como completada si sigue pendiente.

Ante regresión: redeploy en Coolify del commit previo c250fea (o del HEAD observado justo antes de publicar, si main avanzó); conservar datos y credencial recuperada. No revertir SQL, no borrar intentos y no reanudar envíos. Si el despliegue falla, revisar su log y corregir antes de continuar.
