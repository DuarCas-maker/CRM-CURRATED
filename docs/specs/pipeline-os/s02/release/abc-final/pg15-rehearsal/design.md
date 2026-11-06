# Diseño y decisiones — AF-PG15-r1

## PG-ADR01: cluster privado y adaptador de fixture nativo

Se propone PostgreSQL15 portable Windows bajo .local/toolchains y cluster bajo .local/pipeline-os/pg15-049/<run-id>, sin registro de servicio permanente. Permite psql y conexiones físicas sin introducir pg en el package/lockfile. No se asume instalado: adquisición/verificación pendiente. Docker/Podman no están disponibles y wsl.exe por sí solo no acredita un motor; no se inician para explorar. Si se elige luego un runtime distinto, registrar el cambio antes de ejecutarlo.

El controlador futuro usará psql/pg_dump/pg_restore explícitos, procesos por caso y salida estructurada. No reutilizar los clientes Supabase/Gmail/Composio. Entorno de subprocess con allowlist mínima del sistema y variables efímeras del ensayo: eliminar toda herencia PG*/DATABASE_URL/Supabase/proveedor; no leer .env. psql con -X, ON_ERROR_STOP=1, sin prompts ni echo de SQL. No usar --single-transaction:049 ya declara BEGIN SERIALIZABLE/COMMIT y postflight su READ ONLY/ROLLBACK.

## Defensa de destino

Antes de cualquier creación/mutación: binarios15.x verificados; ruta absoluta de datos dentro del directorio del ensayo; marca local de run-id; puerto libre; host127.0.0.1 fijo, sin URI arbitraria. Tras arrancar bajo alcance aprobado: leer data_directory, versión, system_identifier del cluster y base exacta; exigir coincidencia con la marca. Base nueva con prefijo exclusivo abc049_ y marcador sintético; no usar postgres como base de negocio, nombres del CRM, sockets remotos, túneles o puertos de producción. Rechazar antes de escribir si alguna prueba falla.

listen_addresses exclusivamente127.0.0.1, pg_hba solo loopback y SCRAM con secreto efímero del ensayo en archivo privado. El harness no exporta claves reales, no instala extensiones HTTP/FDW ni admite otros SQL/rutas arbitrarias. Registrar la configuración y ausencia de consumidores; loopback limita conexiones entrantes, no constituye por sí solo un firewall de salida. Solo se ejecutan scripts versionados revisados, con llamadas de red denegadas en el controlador y sin procesos web/worker. Cualquier contenedor/VM alternativo requiere su aislamiento de salida definido antes de uso.

## Base reproducible sin exportar producción

1. Portar la inicialización mínima de tests/feature-database.ts: roles anon/authenticated/service_role, auth.uid/auth.jwt y tablas auth/storage necesarias, RLS/grants mínimos. No importar PGlite en el camino nativo ni ejecutar JWT reales.
2. Aplicar001–047 exactos, mantener semillas estáticas ya versionadas y añadir exclusivamente fixtures con correos .test, usuarios superadmin/seller/ajeno/closer, documentos y procesos ficticios. No copiar registros/adjuntos del CRM.
3. Reproducir el owner supabase_admin, defaults/grants amplios y70 grants de servicio del fixture aceptado; fijar ACL/flags necesarios del modelo. La preparación se hace solo dentro del cluster sintético.
4. Aplicar048 exacto solo para construir la base nueva del ensayo. En PG15 no ejecutar el REVOKE MAINTAIN usado por el helper PG18: esa adaptación es del soporte, no de las migraciones originales. No transcribir ni ejecutar íntegro el fixture PGlite en otro motor.
5. Capturar plantilla base y clone para cada caso. Un preflight local debe ser conforme antes de ensayar049; si no, distinguir fallo del bootstrap de incompatibilidad del artefacto. Nunca parchear049 en silencio para compensar un fixture incorrecto.

Roles/defaults/membresías son globales al cluster, no a una base. Los casos que los alteran usarán un cluster desechable propio o restauración explícita y comprobada antes del siguiente caso; clonar una DB no aísla roles. Casos secuenciales, excepto las dos/tres conexiones controladas de contención. No compartir cluster con otro proyecto o pruebas en curso.

## Aplicación, postflight y preservación

En caso positivo, psql envía049 íntegro por stdin; sin sustituir versión/collation/hash. Éxito requiere código cero del proceso completo, recibo correcto y postflight en conexión nueva. Exigir targetsOk/rolesOk/preservationMatches y protectedBefore=protectedAfter=protectedFingerprint, más hashes de contrato/archivo exactos. stage=checked_before_commit sin ese resto no cierra el caso.

Huella de catálogo lógico y datos sintéticos antes/después por columnas originales, identificadores/intentos/Message-ID e historia. Validar solo el backfill access_area fuente-dependiente permitido; lo desconocido sigueNULL. No nuevas marcas/membresías/asociaciones/admisiones, mensajes/outbox/jobs añadidos por la mera aplicación. Las definiciones finales de vistas/funciones deben cumplir el contrato exacto en PG15; divergencia de deparser no se convierte en equivalencia automática.

Guardar recibos/metadatos/SQLSTATE/tiempos y huellas, sin cuerpos de funciones, JWT, secretos o filas. Logs de error sanitizados; no psql -a/-e o errores detallados que reimpriman SQL completo. Registro de stdout de las consultas de casos que solo devuelven booleanos/agregados.

## Concurrencia y recuperación

Conexiones físicas A/B y, para observación, C: comprobar PID/backend distintos. A mantiene el lock mediante BEGIN y una consulta de control; C confirma la espera real antes de liberar o dejar vencer2s. Registrar pg_locks/pg_stat_activity como tipos de lock/estado y etiquetas propias, sin consultas ni datos de terceros. No sustituir esta barrera por un sleep y una ejecución serial.

La segunda captura de049 usa el mismo snapshot SERIALIZABLE; no se presupone detección de todo DDL/DCL confirmado después del snapshot. Un caso controlado documentará esa carrera y la necesidad de exclusión operativa. Éxito de timeout/reintento en clone no elimina ese gate productivo.

En PG-AC12, un SELECT FOR UPDATE de A también mantiene un lock de tabla:049 puede esperar por su ACCESS EXCLUSIVE previo antes de alcanzar el backfill. Registrar el lock real y no atribuir esa espera a una fila o FK interna sin observarla. Este caso verifica presión de DML y preservación, sin acreditar un inventario completo de dependencias implícitas.

Dos recuperaciones distintas: fallo antes de COMMIT debe dejar catálogo/filas iguales; después de COMMIT, restaurar un respaldo del fixture en otro cluster descartable y comprobar huellas/inventario. pg_dump no incluye roles globales: restaurarlos desde la definición sintética versionada antes del dump de base y comprobar propietario/grants. No confiar en que una imagen web vieja revierte permisos. No down de049 sobre datos de negocio ni restauración remota.

## Compatibilidad con consumidores

En este ensayo, adaptar probes SQL de las entradas que web/worker realmente usan; documentar callers e invariantes base/final para distinguir uso compatible y fallo controlado de legacy sin snapshot. No iniciar los binarios reales ni ejecutar jobs de envío para probarlo. Esto da evidencia de contrato SQL, no la matriz completa de imágenes: build Linux y convivencia/recuperación real de binarios siguen siendo gates de publicación separados.
