# Checklist de expediente → producción

SDD STRICT. Autorización explícita del usuario: integrar y publicar, verificar producción sin importación de datos reales ni envío de correos. Ventana: continuación inmediata de esa instrucción, 15/11/2026 America/Bogota.

## Destino y preflight

- Repositorio `DuarCas-maker/CRM-CURRATED`, rama `main`, base remota/coordinador `5e27ed0b48f5d90f637657a6605a11838a891bf3`. Candidato original `5f38ec6`; ningún cruce entre sus 13 fuentes y el incremento de onboarding. Rama de release aislada `codex/case-progress-release-20261115`.
- Coolify existente: CRM - CURRATED / production, web `rv8rpfxhf0mbxprge6h6ki9c`, dominio `crm.finlabinc.com`. Worker `vc4aybj4ucje7zstpsp3zboh`: modo normal activado por otro frente; conservarlo. No tocar env, proveedores, cuotas o cola.
- Dockerfile, `.dockerignore`, healthcheck y puerto ya existentes; no se modifican. No hay DDL, backfill, nuevos secretos ni operaciones financieras. Backup de datos afectados: no aplica porque el incremento es de lectura y UI; no se afirma una nueva prueba de restauración.
- Repetir tests pertinentes/tipos/build sobre la base integrada, usando Node22, env sintético y guard offline. Probar también recuperación de onboarding para preservar el incremento concurrente. Docker local no se presupone; se verificará el build Linux y health de Coolify.

## Ejecución autorizada

1. Sellar únicamente fuentes/tests/documentos propios en el release. Verificar diff y padre, y conservar WIP del coordinador.
2. Hacer push fast-forward del commit a `refs/heads/main`; no force. Si main avanzó, detener el push y conciliar sin sobrescribir cambios ajenos.
3. Esperar el webhook de Coolify y comprobar que web ejecuta el commit exacto, build Linux y rolling update saludables. Redeploy manual solo si el webhook no se entrega; no duplicar despliegues.
4. Si el webhook también reconstruye worker, comprobar su éxito y que conserva normal. No cambiar modos, iniciar pilotos, reintentar jobs, enviar mensajes ni activar proveedores.
5. Smoke HTTP: health 200; nuevo GET anónimo con caso sintético válido debe exigir sesión y usar no-store. Navegador autenticado: abrir un expediente existente, comprobar cinco pasos primero, carga real sin error, IA colapsada y navegación a secciones existentes. No guardar formularios ni analizar/crear/importar registros. Para capturas públicas, usar demo o recortar solo el panel sin datos de clientes.
6. Registrar versión, despliegues, resultados y limitaciones. Adelantar el checkout coordinador con fast-forward únicamente si sigue limpio de cambios tracked y no hay colisiones con WIP.

## Reversa

Si la web no arranca o la proyección falla de forma persistente: rollback del recurso web a `5e27ed0` mediante la versión anterior de Coolify. No modificar base, configuración del worker ni registros para ocultar el fallo. Si ya se publicó el commit pero debe revertirse en Git, revertir solo este delta en un commit posterior, sin reset/force push.
