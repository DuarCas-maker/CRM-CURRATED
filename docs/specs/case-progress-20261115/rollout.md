# Entrega y reversión

Candidato local aislado en `codex/case-progress-20261115`, base `5f38ec6`. Antes de publicar: pruebas pertinentes, tipos, build aislado, QA visual ficticia y revisión del diff. Después, presentar el resultado concreto para autorización explícita de integración/push/despliegue del cambio; la autorización de Conexiones no se reutiliza.

Sin migraciones, backfill ni flags nuevos. Integrar únicamente el manifiesto propio, conservar WIP ajeno, desplegar web y comprobar health/acceso/expediente sin ejecutar acciones. Reversión: volver a la versión web anterior o revertir únicamente el delta de este módulo; no hay datos que revertir.

## Publicación autorizada — 15/11/2026

El usuario autoriza integrar y publicar el checklist, verificando producción sin importar datos reales ni enviar correos. G6 autorizado para este incremento. El detalle operativo está en `publication/runbook.md`.

Preflight: main avanzó a `5e27ed0` con recuperación de onboarding. Sus cuatro archivos no cruzan el manifiesto del checklist. Se prepara una rama aislada desde ese main y se verifican las 13 huellas del candidato antes de copiarlo. El WIP de otros chats no entra al release.

Corrección del contexto operativo: otro frente activó el worker en modo normal con autorización propia y lo verificó después de publicar `5e27ed0`. Se conserva ese modo, no se restaura paused. El checklist no modifica el worker ni crea mensajes; si el webhook reconstruye ambos recursos se verifican salud y configuración efectiva sin operar la cola.
