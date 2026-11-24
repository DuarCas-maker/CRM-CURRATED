# Evidencia

Diagnóstico reproducido y límites en bugfix.md. Observación: 9/9 pruebas (dos de privacidad/error y siete del lector) correctas, sin omisiones. Tipos inicialmente detectaron una anotación ausente en un test, corregida antes de publicar. Recuperación pendiente; no se presenta instrumentación como arreglo.

## Candidato corregido

Regresión roja/verde: mismo test de4.040 leads, rechazo de COUNT con57014; falla antes del cambio y pasa después. Casos de cursor1/17/500/1000, página corta, página vacía final, error posterior, duplicado/orden inválido e identidad/límite: correctos. El lector de casos y los otros catálogos mantienen count exacto.

Suite offline relacionada:119/119 correctas, cero omisiones; runner Node22.23.4, offline.mjs, tsx, concurrencia2, summary-reporter del proyecto. Incluye tasks-overview*, task-leads, pipeline-os-module*, pipeline-master*, pipeline-os-case-flow*, pipeline-performance/load-recovery/mail-metadata, workspace-performance/reader y campaign-center/control/control-http. No se afirma la suite completa del repositorio.

TypeScript --noEmit --incremental false correcto; git diff --check correcto. Build público aislado sin env reales con scripts/verify-tasks-overview-build.mjs: Next16.3.8 --webpack, compilación/tipos/60 páginas correctos.

QA ficticia navegador local: error termina aria-busy, no aparece «Actualizando etapas…»; normal+Reintentar recupera tabla sin alerta y sin GET adicional del tablero (contador0). No se cambia el layout. Revisión safe-code-review: mismo cliente autenticado/vista/columnas, sin service role ni caché/timeout ampliado; progreso de cursor y límite comprobados. Sin esquema, datos, worker, manifiestos/dependencias o infraestructura modificados.

Producción: instrumentación48e2d94 activada, rolling update completo. Medición real57.580ms registrada; corrección y postflight pendientes al sellar este candidato.
