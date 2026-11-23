# Verificación

Evidencia inicial: proxy devuelve 414 para URL de 502 UUID (~19,6 KB) y acepta la longitud de 100 (~4 KB); reproducción SDK aislada falla con el código observado. Producción preserva 502 reservas inciertas sin lote después de ese intento.

## Checks ejecutados

- Node 22.23.4, SDK real con fetch completamente simulado: tests/bouncer-batch-storage.test.ts — 14 pruebas correctas. Incluye 502 y 1.000 UUID únicos, aceptación, cinco rechazos explícitos, respuesta ambigua, fallo parcial y descarga sin POST.
- Regresión conjunta con lead-preparation-tracking, operations y campaign-flow-worker: 20 correctas, cero fallos, cero omisiones.
- TypeScript: node node_modules/typescript/bin/tsc --noEmit — correcto.
- Contraprueba aislada del test nuevo contra worker/bouncer.ts de 8f8c19f: 9 fallos, 5 correctas; reproduce DATABASE_OPERATION_FAILED. No se modificó el archivo de producto para esta contraprueba.
- git diff --check: correcto. Revisión del diff: ambos filtros masivos corregidos, ninguna nueva ruta de reenvío, contratos y reserva previa conservados. No cambios en Dockerfile, dependencias, configuración ni SQL.
- Docker local no ejecutado: no hay engine disponible. Build del worker en Coolify pendiente de comprobación.

## Recuperación y límites observados

GET de enumeración en /v1.1/email/verify/batch devolvió 405; la documentación pública sí ofrece consulta y descarga por ID. No se ejecutó POST de verificación. La automatización nativa de Chrome se detuvo por no poder verificar la URL con suficiente confianza; no se insistió ni se extrajeron cookies o credenciales. Se solicitó al usuario únicamente el ID del lote existente. Falta demostrar igualdad exacta de la cohorte y sus resultados antes de escribir en producción.

La recuperación y el despliegue solo se darán por completados con resultados observados. No se han generado nuevas verificaciones por el agente.

## Publicación observada

Push normal autorizado: origin/main pasó de 8f8c19f a 92a2f1e14dc09d0e92d5e49ac6d4b8ea09f36c94. Lectura git ls-remote confirmó el SHA exacto. GitHub no devuelve estados CI para esta revisión. No se certifica todavía el build ni la imagen ejecutada del worker en Coolify.

23/11/2026 14:05:27 America/Bogota: GET /api/health devolvió 200, status=ok/service=curated-crm. SQL de solo lectura confirmó 502 filas originales (creadas entre 18:20 y 18:23 UTC), todas uncertain_request y sin provider_batch_id; huella MD5 ordenada de IDs 8c984af22950d639e461191f63210f00. La cantidad global uncertain_request subió a 2.502: hay otras 2.000 reservas fuera de la cohorte autorizada, que no se reenvían ni se mezclan con la recuperación. Permanecen 423 errores históricos provider_http_402 ajenos. No se modificó ningún dato remoto para esta recuperación.

## CR-001 ejecutado: tres lotes y funnel conciliados

La sección anterior es el estado previo. El usuario aportó los tres IDs en su siguiente captura y solicitó corregir las cantidades. La autorización de publicación se conserva; la conciliación se amplía como registra CR-001.

23/11/2026 18:46:57 America/Bogota: recuperadas 1.502 verificaciones con resultados existentes (1.000 + 502), conservadas las 52 previamente completadas. Los tres GET de estado confirman completed y las descargas suman 1.554 correos únicos, sin intersección entre lotes. Validación en memoria: una sola verificación de hoy por correo/contacto; 1.554 IDs distintos, lote original de 502 con la misma huella de IDs del diagnóstico. Plan SHA-256 70514e0e2c91b0cd8487bcab37cd649b616aee198b2a3fd4213acf4498cc3372.

Respaldo custom previo: 95.534.079 bytes, listado y decodificación verificados, SHA-256 en backup.json. No se declara una restauración completa de desastre. La asociación usó PATCH de hasta 100 IDs con CAS state=uncertain_request y provider_batch_id=null; cada actualización devolvió el número exacto esperado. Resultados aplicados mediante la función existente en bloques de hasta 500. No cambios de esquema, RLS, funciones, contactos nuevos ni activaciones de campaña. Cero POST de verificación a Bouncer.

Postflight SQL 18:47:24: los 1.554 están completed, 1.318 valid / 118 invalid / 118 uncertain (77 risky + 41 unknown). Cero discrepancias entre resultado y contacto; 4.040 contactos/correos únicos y 4.030 leads/contactos únicos, los mismos totales previos. Los resultados actualizan registros existentes: no deben aumentar el total de leads. Preservadas 423 filas históricas HTTP 402 y 1.000 reservas inciertas ajenas a los tres lotes, sin reencolarlas.

La consulta HTTP desde la sesión CRM real —sin suplantar JWT ni elevar rol— devolvió funnel total=4.030, available=1.318, contacted=769, campaign=1, excluded=350, review=1.592, pending/running/restricted=0. La suma de categorías es 4.030; total de correos válidos en leads=2.088 (1.318 disponibles + 769 contactados + 1 reservado). Se solicitó una página vacía para leer solo agregados sin exponer filas de clientes. El SQL del funnel cuenta la fuente completa antes de paginar; no se encontró una pérdida de filas por el límite de 1.000.

Worker comprobado en el contenedor nuevo vc4aybj4ucje7zstpsp3zboh-20261123T190506: SHA-256 de worker/bouncer.ts b1c82259ba90c195622485d7c0d934ba25c5ba5816199c64dc46b6259c09b04b, idéntico al archivo corregido publicado. Esto verifica la fuente ejecutada; Docker local sigue sin ejecutarse. Fuente productiva corregida y conciliación completadas en el alcance de los tres lotes. Evidencia agregada en recovery-result.json; los archivos temporales con correos permanecen privados en /tmp del contenedor y no se incorporan a Git ni a logs.

Coolify Deployment history observado: Success / Webhook / 92a2f1e / duración 03m 41s. La pantalla real de Pipeline OS → Campañas → Preparar leads muestra Total de leads 4.030 y Disponibles para campaña 1.318; el botón Total de leads cambia a la lista de toda la base. No hubo modificación adicional de frontend para corregir cifras: la recuperación de los resultados restauró la proyección existente.
