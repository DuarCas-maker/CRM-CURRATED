# Procedimiento de publicación de la recuperación

Autorización vigente del mismo chat: corregir/aplicar las mejoras y publicarlas en producción; el reporte actual del fallo es continuación del mismo alcance. El usuario inició sesión en Coolify para permitir leer los logs. No se solicita repetir la aprobación del mismo destino/acción. Cualquier SQL/configuración/credencial nueva quedaría fuera de esta corrección.

Destino: https://crm.finlabinc.com/pipeline-os, repo DuarCas-maker/CRM-CURRATED/main, web Coolify rv8rpfxhf0mbxprge6h6ki9c. Base2d4c6fa verificada, worktree propio. No migraciones o datos por respaldar/modificar en este cambio de lectura; el respaldo anterior de BD no se reejecuta ni se acredita como nuevo.

1. Completar regresión roja/verde del57014, permisos/paginación, cuentas de Tareas/adjuntos recientes, TypeScript, build Node22 público y diff. No instalar dependencias ni abrir env reales.
2. Verificar main, commit propio y push fast-forward. Conservar avances posteriores. Nunca force push/reset/stash ni revertir versiones completas.
3. Observar webhook existente; esperar Finished/healthy/rolling completo. Sin redeploy duplicado o cambios de worker. No reiniciar la BD ni ampliar timeout.
4. GET autenticados Board/Master/Tareas; al menos tres entradas SSR completas y comprobación de navegación/filtros. Logs del tramo final, solo operaciones/códigos y conteos. Smoke anónimo health/login200 y endpoints protegidos401/no-store.
5. Si la consulta acotada también falla, no declarar recuperación: identificar la operación nueva y continuar el diagnóstico con la evidencia, sin ocultarla con dashboard incompleto. No ejecutar SQL remoto por este runbook.

Reversa solo del delta propio preservando2d4c6fa y avances: nuevo commit o imagen anterior si fuese imprescindible por otra regresión; el estado previo reproduce este incidente. No restaurar volúmenes ni datos.
