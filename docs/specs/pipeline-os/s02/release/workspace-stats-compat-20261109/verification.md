# WS-COMPAT — verificación local

09/11/2026. Diagnóstico del entorno publicado: referencia133942001; log `workspace_stats`,42501, tabla conversations. Sin consultas directas nuevas a Supabase ni ejecución remota de SQL. La sesión existente del navegador alcanzó el error de carga; no se solicitó copiar cookies o credenciales.

El caso previo se reproduce en un fixture aislado con las migraciones versionadas y 048/049/050, exclusivamente con identidades/datos ficticios. Después del parche, la misma llamada RPC devuelve los contadores. Se usa PGlite0.5.8, motor PostgreSQL embebido; no es una ejecución nativa PostgreSQL15 ni acredita el catálogo remoto.

Comandos ejecutados con Node22.23.4:

- `node scripts/pipeline-os/prepare-workspace-stats-compat.mjs`: genera determinísticamente cuatro SQL. SourceHash LF previo eb5b1d217a237c8933d252f8a9d6a4d0; corregido2d22ca1953b8a8072abd161c29486ec8.
- `node --import tsx --test tests/pipeline-os-workspace-stats-compat.test.ts`: nueve pruebas correctas, cero fallos, cero omitidas. Red externa bloqueada por el test; cero intentos.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: código0, sin errores.
- Comprobación hash local de publicación:49 archivos operativos privados preservados,050 íntegra, Composio de operaciónfalse e Instantly43/0nuevas. El smoke5GET reportado en esa evidencia pertenece al corte anterior y no se repitió ni se considera validación autenticada.

WS01 reproduce el bloqueo original. WS02 valida archivos y preflight de solo lectura. WS03 compara catálogo completo y datos de conversaciones/mensajes/outbox/jobs/cuentas/marcas/membresías: solo cambia sourceHash de workspace_stats_base. WS04 cubre seller/closer/ajeno, incluido unread oculto del área closer. WS05 conserva denegación raw/anon. WS06 cubre idempotencia/reversa. WS07 rechaza fuente desconocida. WS08 cubre LF/CRLF. WS09 detecta ampliación indebida del grant y falla cerrado.

Revisión del diff: no se introducen grants, security definer ni escrituras de negocio; se preserva el encabezado de pg_get_functiondef y se comprueba todo pg_proc excepto prosrc. Transacción serializable, lock_timeout5s y statement_timeout30s. No se cambian los paquetes históricos048/049/050 ni código de la app/worker. Las validaciones finales históricas de050 certifican su corte original; después de051 no deben repetirse como postflight del nuevo incremento.

Pendiente: revisar preflight en el destino real, aplicar el SQL concreto con autorización remota y observar postflight independiente; volver a cargar el CRM, terminar la revisión de pantallas y preparar el microensayo con identidades, horario y presupuesto reales. No se acepta aún el piloto ni se habilita Composio, OAuth, worker o envío por estos resultados locales.

## Revisión WS-COMPAT-r2 tras el error remoto

El operador ejecutó051r1 y reportó WS_PRESERVATION_MISMATCH. No se recibió DETAIL con campos. Se verificó un defecto concreto: comparación byte a byte de proargdefaults, que incluye posiciones del parser enPG15. Prueba auxiliar en PGlite reportó180003 y defaults invariables tras recrear; el código fuente oficial15/18 explica la diferencia de serialización. Esto no es evidencia de la diferencia exacta del catálogo remoto.

Los cuatro SQL generados ahora llevan WS-COMPAT-r2. El sourceHash de negocio objetivo y el alcance de un único contador no cambian. Se agrega cleanup.sql para ROLLBACK de limpieza, separado de rollback.sql que revierte el parche de negocio.

La suite actualizada pasó12/12, cero fallos/omitidas y cero intentos de red. WS10 reproduce el rechazo r1 mediante un modelo explícito de ubicaciones15 y verifica que defaults reconstruidos iguales pasan y distintos fallan. WS11 inyecta un cambio real de default durante el DDL de fixture, comprueba DETAIL proargdefaults y la reversión total. WS12 inyecta cambios de propietario, ACL, security definer y search_path: todos siguen abortando. Los nueve escenarios previos continúan pasando.

El reconocimiento PG15 se basa en fuentes primarias y en ese modelo; no se ejecutó nativamentePG15 ni se retiró ninguna condición para simular éxito. La aplicación remota/r2, su postflight y la recuperación de la UI continúan pendientes de evidencia del operador. No hubo APIs, cambios remotos, despliegue o mensajes por esta corrección local.

## Postflight recibido y recuperación observada — 09/11/2026

El operador entregó el postflight independiente de051-r2: versión150008, targetsOk/sourceExpected=true y sourceHash2d22ca1953b8a8072abd161c29486ec8. Todos los controles de invoker, stable, search_path vacío, RLS/política restrictiva, SELECT protegido y ejecución autenticada/anon son correctos. El recibo íntegro no sensible está en operator-postflight.json. Se acepta la persistencia de la corrección según esa evidencia; el agente no aplicó SQL remoto ni repitió050.

Después se recargó la sesión existente en crm.finlabinc.com y se observó el resumen «Tu operación, en perspectiva.» sin el error133942001. En Configuración aparecen Marcas y asignaciones, Asociación Composio, Conectar Gmail con Composio y Transporte de cada cuenta, sin alertas de carga observadas. La colección Marcas está vacía; Cuentas y marca actual muestra un buzón conectado con «Marca pendiente de revisión». Los selectores normales de asociación/transporte no ofrecen cuentas aún; no se infiere ni se aplica una asignación real por el dominio del correo.

Esta revisión es solo consulta del delta publicado. No acredita marca/asignación real, alta OAuth, piloto ni reanudación del worker. El próximo paso operativo es confirmar la marca del buzón, revisar y aplicar R02 por su flujo normal; conservar Composio apagado y el worker pausado hasta el paso autorizado correspondiente.

La consulta «Revisar disponibilidad y contexto» del panel de alta devolvió «El alta con Composio no está habilitada. Gmail directo conserva su configuración», sin alertas. Se verificó en el código que la rama disabled de este GET termina antes de leer configuración/proveedor; no se inició OAuth ni se llamó a Composio. La captura parcial del navegador no encuadró ese mensaje y no se usa como prueba; la evidencia es la observación del texto del panel. La identidad/marca real se consultó al operador, sin aplicarla todavía.
