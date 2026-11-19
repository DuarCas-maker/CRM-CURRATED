# CR-001 — Publicación del ajuste por correo

Mismo objetivo autorizado en esta conversación: «Sí, despliega estos cambios en producción para que la tabla y los filtros ya aparezcan en el CRM». El usuario corrigió la agrupación a una fila por correo y confirmó A/A para pendientes y deduplicación. Se publica ese ajuste sobre el mismo CRM; no se solicita de nuevo autorización para el despliegue ya concedido.

Destino existente https://crm.finlabinc.com/pipeline-os; repo DuarCas-maker/CRM-CURRATED, main; Coolify web rv8rpfxhf0mbxprge6h6ki9c. Node22-alpine, pnpm11.19.0, Dockerfile y healthcheck actuales sin modificaciones. Rollback de referencia c0ef7a9. No hay SQL, migración, configuración, transporte, worker, mensaje externo ni datos de negocio modificados.

1. Completar tests/tipos/build y QA ficticia. Revisar diff y congelar fuentes propias; conservar raíz y documentos anteriores.
2. Verificar main vigente y publicar solo el commit propio por fast-forward en el webhook existente; ante avance concurrente, conservarlo y repetir checks afectados, sin force push. No lanzar redeploy duplicado.
3. Esperar Success del SHA exacto en Coolify. Health200/login200, API anónima401 y stage inválido400; no-store.
4. Sesión humana existente con MFA: recargar Tareas, observar9 columnas y una fila por correo único sin nombres de responsables; comprobar selección Daniel/Samuel/Valentina, pendientes/respuestas y vuelta a Todos. Registrar solo agregados y booleanos, nunca leads/cuerpos/cookies/tokens.
5. Guardar evidencia segura y resultado local después de observarlo. Mantener el CRM en Todos y no provocar otro redeploy únicamente por añadir el acta.

Criterio de éxito: tabla única por dirección, métricas completas por cuenta, filtros y etapas coherentes, permisos intactos y UI sin alerta. Ante fallo, corregir la causa con evidencia o recuperar la imagen c0ef7a9, preservando configuración/datos/cambios concurrentes. No restablecer toda la rama ni restaurar la base.
