# CW-I02 — continuidad de la integración de alta

Las siete fuentes de motor/proveedor T-003/T-004 están recibidas bajo sus huellas y sin modificar producto existente. Los dos recibos de origen de esta carpeta se conservan como evidencia histórica; los resultados ejecutados en root van en verification.md/manifest.json, no se atribuyen a F2.

## Revisión reproducible

Usar Node22 y dependencias existentes con `--import ./.local/pipeline-os/worker-control-20261108/offline.mjs --import tsx --test`; suites `tests/pipeline-os-s02-connect-contract.test.ts`, `tests/pipeline-os-s02-connect-provider.test.ts` y `tests/pipeline-os-s02-connect-composition.test.ts`. Para la regresión C3 se usa además `--experimental-test-module-mocks`. No iniciar worker/web, leer env, instalar o pedir credenciales para estas pruebas.

El store de `tests/fixtures/pipeline-os-s02-connect-composition.ts` es un doble deliberado; no debe importarse en producto ni presentarse como adapter de PostgreSQL. Se prueba motor + adaptador HTTP inyectado con respuestas sintéticas, no un OAuth real. El hash de contexto se comparte con C2/R06; el perfil de alta no acredita scopes efectivos y C2 debe seguir bloqueando si faltan.

## Siguiente recepción: T-009

F2 está implementando cifrado/store/fases durables en su propio worktree. No copiar esos archivos mientras el turno siga activo o falten recibos finales. El siguiente incremento del coordinador deberá:

1. Revisar recibo final y scope de T-009, cotejar sus fuentes exactas y compatibilidad con T-003/T-004. No modificar el checkout F2, copiar su `.local`, cluster, dependencias o secretos.
2. Conciliar el delta SQL con CW-I01 y R06-I01/I02/I03. CW ya tiene una corrección monotónica en config_publish; R06 añade selección, evidencia C2 post-activación y recepción. No reescribir los originales ni aplicar el SQL nativo F2 como si fuera una migración final sobre la base actual.
3. Ensayar el conjunto con roles/sesiones/CAS/capacidades, registro bajo identidad humana y reversa. Diferenciar la evidencia PG15 física de F2 de la nueva composición root; no heredar una certificación de locks o18 casos históricos.
4. Completar caller/configuración/rutas/cookies/UI de alta con las guardas existentes, después del store verificado. Acabar OAuth crea candidato, no permisos de envío, una marca aprobada automáticamente ni un transporte activo.
5. Preparar paquete SQL final/catalog/preflight/postflight y corte web/worker. Se conserva la autorización productiva general previa, pero este incremento no ejecuta SQL remoto, push o deploy y no repite048/049.

Configuración/proyecto/cuota/callback reales, asignaciones, habilitación live/sync y piloto Composio con presupuesto propio siguen pendientes. Instantly43; cero llamadas nuevas por este trabajo. Reversa local: retirar únicamente las nueve adiciones de producto/test de CW-I02 tras revisión; ninguna fuente existente cambió y no hay efecto remoto que revertir.
