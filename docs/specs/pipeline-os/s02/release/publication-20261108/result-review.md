# Resultado de publicación conjunta web/worker

SDD STRICT · protocolo PUB del 08/11/2026. Resultado verificado al finalizar el corte del 09/11/2026. Este registro queda local, sin otro push ni despliegue por documentación.

## Evidencia y aceptación

- PUB-FR01/AC01/T01–T03: main remoto revisado antes del push; avance fast-forward desde fb9f201. Publicado `00b00937b8de7eea1966a6b2c3189bf1c9db8023`, con 178 archivos públicos revisados. Se conservaron los cambios existentes y no se incluyeron env reales ni artefactos privados.
- PUB-FR02/AC02/T01–T02: 301 entradas de producto cotejadas con el build aislado aceptado. Evidencia de regresión: 369 casos/grupos correctos, 2 omisiones opt-in nativas, 0 fallos. TypeScript volvió a pasar antes de publicar. No se repitieron pilotos aceptados de recepción, adjuntos o importación.
- PUB-FR03/AC03/T04: web y worker construidos/desplegados en Linux por los recursos existentes de Coolify 4.6.0, ambos con el commit publicado. Web: despliegue `amnypj68kuisegncl4n7lewc`, Finished/Success, healthcheck healthy a las 05:03:24 UTC del 09/11/2026. Worker: último despliegue `uvrefhmb80brxsbu233er5p7`, Finished/Success, healthcheck healthy; log del contenedor nuevo confirma `Execution mode: paused`.
- PUB-FR04/AC04/T04–T05: cinco GET sin sesión a la app pasaron: salud 200, login 200 con CSP del incremento, raíz 307 a login, alta Composio sin sesión 403 `CONNECT_FORBIDDEN`, control técnico Instantly apagado 404/no-store. No se llamó a la API de Instantly ni se armó un ensayo. No se activó Composio/routing/webhook ni se disparó un envío.
- Comprobación final local: 49 huellas operativas privadas preservadas; 43 peticiones Instantly consumidas, 0 nuevas; artefactos 050 íntegros y código de operación Composio en false. No se ejecutó SQL remoto ni se repitió 050.

## Incidentes resueltos durante el corte

El primer worker arrancó en normal, a pesar de la confirmación previa del operador. Los logs mostraron un trabajo gmail_sending_usage y uno gmail_sync completados. Se detuvo el recurso sin Docker Cleanup; la variable WORKER_EXECUTION_MODE no existía en ese recurso. Se agregó paused como variable de producción disponible en runtime, se verificó su valor y se volvió a desplegar. El despliegue corregido `oyfnoyhwiig2htqofv3brrhf` y el posterior automático terminaron saludables. No apareció un trabajo de envío en los logs consultados; esta observación no equivale a una auditoría completa de actividad externa.

El webhook de despliegue llegó con demora después del push y de los despliegues manuales del worker. Se observó el despliegue automático de web y el relevo automático del worker; no se alteró la integración Git. La web falló dos veces por timeouts de registry.npmjs.org (primero pnpm, después el tarball de Next.js). El último reintento del mismo commit descargó las dependencias, compiló y superó el healthcheck sin cambiar Dockerfiles, versiones o lockfile. La terminal de Coolify permaneció en connecting, por lo que no hubo una prueba independiente de conectividad del host. El fallo observado fue de descarga, no de compilación; no se certifica una reparación permanente de la red.

## Límites y siguiente paso

Gmail directo se conserva como proveedor; el worker pausado mantiene detenidos los trabajos de fondo. Composio y el webhook Instantly siguen apagados. Publicar el código no acredita el alta OAuth ni el piloto operativo autenticado de esta versión. Esos son el siguiente bloque: revisión en la sesión habitual de las pantallas nuevas, asignaciones reales y piloto acotado; activar proveedor/routing o reanudar worker requiere su paso explícito de operación.

No se repitió el ensayo nativo PG15, no se tocó Supabase en este corte, ni se certifica otro backup o restauración. La aplicación 050 y su postflight aceptado corresponden a la ejecución previa del operador.

Evidencia privada no publicable: `.local/pipeline-os/publication-20261108/` contiene push/preflight/smoke/preservación, observaciones y capturas de Coolify. Solo este resumen describe resultados sin secretos ni datos de clientes.

## Hallazgo posterior de revisión autenticada — 09/11/2026

El siguiente recorrido de la sesión del CRM encontró un bloqueo de carga: referencia133942001; log workspace_stats/42501, permission denied for table conversations. Esto no invalida los resultados de build, health o GET anónimos, pero impide dar por aceptado el uso autenticado. El agregado heredado intenta leer needs_attention de la tabla raw, restringida deliberadamente por049. Corrección local y evidencia: [WS-COMPAT](../workspace-stats-compat-20261109/bugfix.md). No se aplicó todavía ese cambio en remoto ni se inició el piloto.
