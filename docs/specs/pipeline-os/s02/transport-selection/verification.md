# R06 — evidencia de preparación

Estado vigente: [I03 recepción/panel implementados offline](i03-verification.md),262 correctos/una omisión nativa. [I02](i02-verification.md) e [I01](i01-verification.md) conservan sus recibos históricos. SQL final/concurrencia física, integración del alta F2 y operación real pendientes; Composio bloqueado, Gmail directo e Instantly43 conservados.

Constancia histórica de preparación. Estado posterior: **I01 implementado y probado offline**, [evidencia del incremento](i01-verification.md). Los cero tests y367 archivos sin cambios que se describen abajo corresponden a la preparación original; el incremento añade seis archivos propios sin modificar esos367.

08/11/2026 · SDD STRICT · **solo preparación local**. [Especificación](spec.md), [diseño y ADR](design.md), [tareas](tasks.md), [aceptación futura](acceptance.md), [inventario/manifiesto](manifest.json).

## Qué se verificó

1. Arquitectura y callers reales: fachada/token/proxy, C1/C2, scheduler/polling/watch, cursor vivo/histórico, callback directo/push y guardas B2/WC. Los paths y hashes leídos están en manifest.json. Se corrigieron rutas de inspección inicialmente inexistentes usando el inventario del repositorio; no se trataron como archivos faltantes del producto.
2. Preparación de tres incrementos finitos, seis archivos nuevos propuestos para I01; FR01–10/AC01–10 trazados a tareas, con propiedad del coordinador y sin solapar los cuatro archivos T-003 de F2.
3. Revisión del estado F2: autorización del usuario recibida, T-003 en implementación según snapshot del chat; su plan declara motor con dependencias falsas, sin store productivo/adaptador real/rutas/UI. No confundir T-003 con el alta completa. No se incorpora trabajo parcial ni se envían mensajes.
4. Formato/enlaces locales y estructura del manifiesto; conservación de todos los367 archivos públicos de producto/build detectados al inicio, HEAD e índice y las49 huellas operativas. Las guardas 048/049 y los paquetes históricos permanecen. Resultado exacto del cotejo en manifest.json.

No se ejecutaron nuevas suites de producto: no hay cambios funcionales. Los101 casos correctos/una omisión nativa de CW-I01 y18 nativos de origen F2 conservan su alcance histórico; **no prueban R06**. Las diez aceptaciones de esta preparación son casos por implementar, no resultados.

## Hallazgos que resuelve el diseño

- Seleccionar después de gmailToken haría llamadas directas aun en una cuenta Composio.
- Resolver usando solo status=connected/una fila mail_credentials deja fuera las cuentas nuevas sin refresh token directo.
- C1 verified es asociación revisada, no selección activa; introducir active en su tabla contradice constraint/guard actuales.
- ready/xmin/contexto C2 y la cuenta R05 disconnected requieren puente y transición de evidencia explícitos; no activar status para obtener una verificación aparente.
- Scheduler/renewWatch/push y callback OAuth directo pueden ejecutar trabajo antiguo o alterar estado; hay que cercar también esos recorridos y emisores viejos.
- Una lease vencida o la ausencia de usuarios no prueba que no queden llamadas en vuelo. No se puede prometer rollback mediante fallback de envío.

## Gates y límites

G0/G1: arquitectura/alcance y decisiones humanas reutilizadas. G2/G3: diseño e incrementos preparados para revisión e implementación local; el SQL exacto, orden de locks y puente C2 deben completarse/probarse en I01. G4/G5 de producto y QA física/visual siguen pendientes. La autorización general de producción recibida no se revoca, pero no existe todavía una versión R06 ejecutable para desplegar.

Sin APIs reales, enlaces OAuth, credenciales reales, SQL remoto, servicios, mensajes, push o deploy por esta tarea. Gmail directo activo, Composio deshabilitado e Instantly43/0 nuevas. F2/F3 y su trabajo quedan intactos.

Siguiente paso concreto: implementar R06-I01 con sus seis archivos propuestos, dependencias falsas y SQL local reversible; mantener la fachada actual hasta I02. Al terminar, integrar únicamente las entregas terminadas F2 y adaptar el piloto F3 al transporte Composio antes de tráfico real.

Rollback de esta preparación: retirar únicamente esta carpeta/referencias tras conservar la evidencia si se decide descartarla; ninguna reversa de base, deploy o restauración de privados es necesaria. No usar reset/stash/clean sobre el WIP compartido.
