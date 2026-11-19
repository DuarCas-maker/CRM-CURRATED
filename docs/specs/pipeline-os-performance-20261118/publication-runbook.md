# Publicación del incremento de rendimiento

Autorizaciones del mismo chat: «Sí, por favor, despliega estas mejoras en producción y verifica después que la aplicación cargue más rápido y sin errores», seguida por el nuevo alcance Pipeline OS/todas las secciones y «Sí, revisar y aplicar las mejoras». Se conserva el destino y el flujo de publicación; sin nueva operación de BD ni proveedores.

Destino verificado: https://crm.finlabinc.com, main en DuarCas-maker/CRM-CURRATED, Coolify4.7.5, aplicación web rv8rpfxhf0mbxprge6h6ki9c. Pipeline automático existente mediante webhook Git. Node22/pnpm11.19 del Dockerfile, standalone, usuario no-root, healthcheck /api/health. Docker local no disponible; build aislado de fuentes públicas y pipeline Linux son evidencias distintas. No tocar variables/DNS/worker ni abrir .env.

1. Revisar las tres fuentes propias (pipeline-read-queue.ts, pipeline-os-module.ts, pipeline-master.ts), regresión, benchmark contra087e951, tipos y build exacto. Preservar la observabilidad fea58d0 añadida en paralelo, sin copiar registros privados de otro frente.
2. Confirmar main de nuevo. Commit propio de fuentes/tests/spec; push fast-forward mediante autenticación Git existente. Si avanzó, conciliar y verificar delta afectado. Nunca force push, reset, stash ni restaurar WIP ajeno.
3. Observar el despliegue creado por webhook, sin redeploy duplicado. Esperar Finished, healthy y rolling completo. El worker puede reconstruirse automáticamente sin cambio operativo solicitado.
4. Smoke anónimo: health/login200 y endpoints Workspace/Board/Master/Tareas401 privados/no-store. Sesión humana existente: repetir Board(group files), Master(default), Tareas(default), entrar y abrir las secciones de Pipeline. Guardar tiempos, longitudes/conteos y flags, nunca cuerpos/registros ni cookies. Comprobar consola y alertas.
5. Si no mejora o aparecen errores, no declarar éxito: usar métricas seguras ya existentes y diagnosticar el nuevo cuello de botella. No aumentar timeouts ni saltar fuentes para producir un falso resultado completo.

Reversa: nueva revisión que retire solo este incremento, preservando avances posteriores; alternativamente imagen anterior fea58d0 conforme al mecanismo Coolify. Sin restauración de datos, SQL o cambios de infraestructura. Detener publicación ante checks fallidos, permisos distintos o pérdida de contrato.
