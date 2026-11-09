# R06-I03 — revisión local y siguiente integración

Gmail directo sigue siendo el modo activo configurado previamente; routing está apagado por defecto, Composio bloqueado en código e Instantly43. Este incremento no usa credenciales reales, proveedores, Supabase remoto, envíos, push ni deploy.

## Qué revisar

1. [Diseño](i03-design.md), [evidencia](i03-verification.md) y [manifiesto](i03-implementation.json). El delta declara nueve fuentes existentes y doce nuevas de código/SQL/tests; las fuentes originales de envío/ingestión se reconstruyen exactamente después de retirar solo las dos ramas nuevas de recepción/watch.
2. `r06-i03.local.sql` es un candidato de ensayo, sin ordinal. Requiere el marcador local y una transacción externa sobre la composición I01/I02/CW, nunca repetir048/049. Los tests en memoria comprueban aplicación y ROLLBACK, firmas/ACL y tres reemplazos source-pinned. No es todavía el archivo final para producción.
3. El panel se abre sin cuenta preseleccionada y consulta solo al pulsar Revisar estado, con sesión superadmin/MFA. Con el flag apagado responde administración no habilitada. En modo nuevo, seleccionar directo, preparar transición y confirmar son pasos distintos con CAS/idempotencia; pausar/cancelar siguen disponibles para detener Composio aunque su operación esté bloqueada. No se habilitan permisos, campañas ni recepción live/sync por seleccionar transporte.
4. Los jobs nuevos contienen `route_revision`. En modo nuevo se retiran los sync/watch antiguos sin revisión; el scheduler encola la revisión actual después. Un aviso push anterior solo encola si la ruta actual es directo, está lista y tiene recepción habilitada. Composio hace polling y no necesita una fila `mail_credentials`.
5. Un ciclo fallido no mueve el cursor. Si el rechazo HTTP es acreditado se aborta sin reintento dentro del ciclo. Si queda una petición sin resultado, el ciclo queda incierto, visible como bloqueo de trabajo pendiente; no borrar filas ni liberarlo por tiempo. La conciliación y el siguiente intento deben formar parte del protocolo final de operación.

## Checks locales reproducibles

Node22 del toolchain existente, sin instalación. Las cinco suites nuevas son `tests/pipeline-os-s02-mailbox-{runtime,runtime-db,runtime-api,ui,push}.test.ts`. Ejecutar con `--import ./.local/pipeline-os/worker-control-20261108/offline.mjs --import tsx --experimental-test-module-mocks --test --test-concurrency=1`; conservar `PIPELINE_OS_CONNECT_T002_NATIVE=0` en estas pasadas. TypeScript directo: `node_modules/typescript/bin/tsc --noEmit --incremental false`.

La QA visual usa HTML propio de fixtures con los estilos existentes y CSP sin red. Edge headless se ejecutó con perfil propio, resolución externa bloqueada y CDP únicamente en loopback. Capturas360/768/1280 ES/EN y tabulación del panel; no se leyó ninguna sesión, cookie ni pantalla productiva. No equivale al recorrido completo del modal/hidratación dentro de la aplicación desplegada.

## Antes de publicar

- Integrar entregas terminadas de F2 manteniendo su aislamiento y conciliar T-009/persistencia, configuración y correlación cifrada antes del caller HTTP/UI de alta. T-003/T-004 offline no son alta real operable.
- Preparar un paquete SQL final nuevo de CW/R06/alta, con catálogo/preflight/postflight/reversa compatibles con el049 ya aplicado. Ensayar DDL y concurrencia física/corte; no copiar los candidatos locales al SQL Editor remoto.
- Completar QA del delta en la app, modal/MFA/teclado y build web/worker en el Coolify existente. No instalar otro VPS ni exigir un build independiente por este runbook. La autorización productiva general previa se conserva; este turno no la ejecuta.
- Coordinar pausa/drenado de todos los emisores viejos antes de cambiar el flag; los binarios antiguos no obedecen las rutas nuevas. Inicializar explícitamente las cuentas heredadas como directas, sin fallback de envío.
- Revisar asignaciones reales, habilitar live/sync para la cuenta autorizada y acreditar identidad/proyecto/cuota/configuración. Preparar piloto Composio con un presupuesto propio; las43 peticiones de Instantly y los presupuestos históricos no autorizan tráfico nuevo.

Reversa local: retirar solo este delta tras conservar evidencia, sin reset/stash/clean. Reversa operativa futura mediante pausa/drenado/revisión explícita y credencial directa legítima, nunca restaurar049 ni reenviar automáticamente una operación incierta.
