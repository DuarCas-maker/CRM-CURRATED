# Aplicación productiva050 — decisión del operador

**Estado posterior:050 aplicada por el operador y postflight conforme. [Revisión](result-review.md). Los pasos siguientes son el protocolo histórico; no repetir la aplicación.**

08/11/2026 · SDD STRICT. El usuario indicó «Quiero aplicarlo en produccion» al proponerse aprovisionar PostgreSQL portátil para el ensayo. Se sigue la aplicación productiva del candidato **050/MR-AUTH-r1**, sin descargar herramientas. El ensayo PG15 aislado queda pendiente; no se declara completado. Esta instrucción posterior sustituye el orden propuesto de exigirlo antes del corte, conservando las guardas SQL y los límites del tráfico externo.

## Estado comprobado

El preflight recibido del operador tiene catalogOk/queueOk=true, mismatchCount0, cola y campañas/jobs activos0, contrato2482d33acb4f33e1228915bbe3261030998aa5b363f936aa1b15ba1942c30cb7. La copia corregida050 y su postflight se cotejaron con el manifiesto sellado. No hay aplicación exitosa050 observada todavía. readyToApply=false es fijo en ese informe y no mide autorización ni pausa de procesos.

Destino: Supabase **self-hosted del CRM Qrated**, https://supabase.finlabinc.com/, mismo proyecto Coolify CRM-CURRATED del recurso web CRM y curated-worker, app https://crm.finlabinc.com/. No usar otro proyecto. Aquí no hay herramienta administrativa API conectada a ese Supabase/Coolify; el operador ejecutará los pasos en sus paneles. No se leyó una clave ni se intentó otro servicio.

## Pasos del operador

1. En Coolify, detener temporalmente el recurso web CRM y curated-worker; esperar el estado detenido de ambos. Mantener Supabase encendido y evitar otros escritores/despliegues durante el corte. No basta cerrar el navegador ni observar una cola vacía. Si no se puede confirmar la pausa, no ejecutar el paso2.
2. En el SQL Editor del Supabase correcto, abrir la [050 corregida completa](../mail-runtime-final/050_integrate_mail_runtime_and_connect.sql) y ejecutar desde BEGIN hasta COMMIT, una sola vez. No seleccionar fragmentos ni añadir otro COMMIT. No ejecutar048/049 o los archivos local-only. El instalador vuelve a comprobar contexto/catálogo/cola bajo locks.
3. Si aparece un error, conservar mensaje/DETAIL; no reintentar. Si la sesión queda abortada tras ese intento, limpiar con ROLLBACK, sin mezclar trabajo pendiente de otra operación.
4. Si termina Success, ejecutar el [postflight READ ONLY](../mail-runtime-final/postflight.sql) y compartir su JSON. Exigir targetsOk=true, mismatchCount0 y el contrato indicado. El SELECT checked_before_commit del instalador no sustituye esta lectura posterior.
5. Mantener la pausa hasta revisar el postflight y coordinar la continuación de web/worker. Este paso no publica código ni activa Composio. Gmail directo se conserva; alta/routing/webhook siguen apagados, Instantly43 y cero envíos/verificaciones pagas autorizados por esta aplicación.

Reversa del intento antes de COMMIT: ROLLBACK transaccional. Después de una aplicación exitosa, conservar los schemas/recibos y seguir corrección hacia delante y el protocolo de publicación; no borrar Auth, historial o volúmenes ni repetir049. No se ejecutó una reversión remota.

Esta constancia registra instrucciones y autorización; no afirma pausa confirmada, backup nuevo, aplicación050, despliegue o ensayo nativo realizados.
