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
