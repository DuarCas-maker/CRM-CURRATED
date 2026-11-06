# ABC-WW-20261105 — versión conjunta web/worker

SDD STRICT · preparación local autorizada el 05/11/2026. Se reutilizan D01–D24 y el alcance I01+A+B1+B2+C1/C2/C3 ya aceptado. La ronda de clarificación está cerrada por la instrucción actual y las decisiones anteriores: no hay funcionalidad nueva ni cambio de proveedor que decidir. La preparación no autoriza push, despliegue, APIs, SQL remoto, arranque del worker ni reanudar servicios reales.

## Requisitos y aceptación

| FR             | Criterio                                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WW-FR01 / AC01 | Fijar las fuentes públicas exactas para web y worker desde el checkout coordinador, con base Git y manifest de rutas/hashes. Conservar el WIP; no copiar S01 ni hacer commit/push por preparar.                                                                                   |
| WW-FR02 / AC02 | Conservar los 100 archivos funcionales del payload, dependencias y Dockerfiles. Gmail directo seleccionado, Composio sin selector activo y ensayo Instantly apagado. 43 peticiones y 49 hashes operativos intactos, sin abrir env reales.                                         |
| WW-FR03 / AC03 | Reconciliar el destino existente: 048/049 ya comprobadas; despliegue y comandos de arranque no deben ejecutarlas. La secuencia para nuevas bases se documenta aparte, sin incorporar 049 al autodiscovery base47 usado por fixtures.                                              |
| WW-FR04 / AC04 | Revisar empaquetado, rutas/imports del worker, TypeScript y delta. Comprobar capacidad de build; no repetir un build conocido fallido sin cambio de entorno, desactivar standalone o instalar/arrancar Linux. Distinguir el archivo de fuentes de una imagen ejecutable validada. |
| WW-FR05 / AC05 | Preparar QA visual con fuentes vigentes y datos ficticios, sin conexiones externas. Registrar lo realmente inspeccionado y mantener pendientes las combinaciones no observadas, sin repetir pilotos aceptados de recepción/adjuntos/importación.                                  |
| WW-FR06 / AC06 | Entregar runbook de publicación coordinada y recuperación compatible con 049: mismo candidato para ambos recursos, control del autodeploy y del worker, bootstrap revisado y smoke limitado al delta. No publicar ni reanudar por esta entrega.                                   |

## No objetivos

Activar Composio, crear otra app/VPS, instalar dependencias o Docker, iniciar WSL o PostgreSQL, rotar secretos, crear marcas/membresías reales, enviar mensajes, volver a verificar leads o aplicar SQL. Tampoco convertir el resultado productivo de 049 en prueba de contención/restore ni una captura local en QA de toda la aplicación.

## Gate de esta entrega

La preparación puede completarse con un candidato de fuentes sellado y límites comprobados. `readyForPush` y `readyForDeployment` siguen false mientras falten la construcción Linux exacta, QA restante y controles operativos de publicación. No se certifican artefactos o permisos que no se hayan observado. La decisión previa del usuario de prescindir de respaldo no se reabre ni se presenta como recuperación probada.
