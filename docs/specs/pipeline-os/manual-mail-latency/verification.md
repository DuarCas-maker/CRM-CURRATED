# Verificación — envío manual con baja latencia

SDD STRICT · implementación local, publicación pendiente. Rama codex/manual-mail-latency, base 01b6d3f. Copia aislada con dependencias existentes por junction; sin env reales o privados copiados, paquetes instalados, llamadas nuevas de proveedor o mensajes de ensayo. Runtime Node 22.23.5; PG nativo 15.19 de la herramienta oficial ya provisionada.

## Resultados

| Check                                  | Resultado observado                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funcional/DB/API/concurrencia/pilot/B2 | 57/57 correctos, cero omitidos. evidence/targeted-final.tap. Incluye PG15 con dos conexiones físicas, instalación/reversa/reinstalación, exclusión de cuenta, ausencia de fallback y no replay de POST incierto. |
| Pre/postflight SQL y permisos          | 13/13 del archivo manual-mail-database tras añadir los scripts de lectura; dueño distinto rechazado, service permitido, anon/authenticated denegados, dueños y search_path correctos.                            |
| Tipos                                  | next typegen y tsc --noEmit --incremental false correctos con Node22.                                                                                                                                            |
| Compilación                            | next build --webpack correcto en esta copia sin env. evidence/build.log.                                                                                                                                         |
| Suite completa                         | 1508 enumerados: 1496 correctos, 3 fallos, 9 omisiones opt-in; 529 s. No se declara suite completamente verde. evidence/full-suite.tap.                                                                          |
| Diagnóstico de UI ajena                | 9/9 correctos al aportar explícitamente el cargador CSS de ensayo. No se cambió el runner o tests de producto para ocultar errores.                                                                              |

Los fallos completos preexistentes son dos imports CSS en connections-ui y pipeline-os-case-progress-ui, y una aserción de pipeline-os-s02-block-b-ui que aún espera InstantlyTrialControl en integrations.tsx tras su traslado anterior a Conexiones. Los archivos de esas pantallas/tests coinciden con la base por git diff --exit-code. La compilación productiva sí procesa CSS; el loader adicional solo permite ejecutar los asserts SSR locales.

La suite completa terminó antes del último refuerzo de exclusión de sending antiguo. Ese caso falló primero (1 claim frente a 0 esperado), se corrigió y las 57 pruebas relacionadas se repitieron sobre el SQL final. No se reutiliza la suite previa como una ejecución nueva. También se corrigieron fixtures de cuotas y campañas para respetar las validaciones vigentes; no se modificaron constraints ni guards para acomodar tests.

## Trazabilidad y límites

FR-001/002: despacho independiente, rotación, máximo por cuenta y prueba física entre procesos. FR-003/004: manual tras 1 s, Retry-After/cupo conservados, prueba de campaña real y notificación mantienen 30/60 s. FR-005: polling adaptativo, exclusión de cargas activas y cleanup. FR-006: ACL, dueño, revocación, claim exacto y uncertain sin replay.

La meta de 2–5 s exige medición posterior con mensajes reales aprobados; aquí no se promete tiempo de entrega al destinatario ni se declara implantado el cambio en producción. SQL remoto, publicación, flag runtime y prueba real siguen pendientes de autorización específica. Rollback ensayado en fixtures y PG15; no se ejecutó reversa en producción.

## Paquete y revisión de integración

Patch local preparado y git apply --check correcto contra el coordinador en a34a08938cc637aa28b5176af31368cce30c554c. Los cuatro archivos existentes modificados por este incremento no cambiaron entre la base 01b6d3f y ese HEAD posterior. No se aplicó el patch en el checkout del coordinador; tampoco se alteró su índice o WIP.

git diff --cached --check correcto tras corregir líneas vacías de EOF de los SQL. Chequeo final de tipos aprobado después de las últimas adiciones de tests. El manifiesto fija los archivos seleccionados por SHA256; los logs completos y el patch permanecen como evidencia local sin publicación.
