# Diseño de la entrega conjunta

## Fuente y procedencia

Base `fb9f2015e682fc0704340530425322efc62c601b`, rama local `codex/s00-auto-receive`. Orden de resolución de fuentes: I01→A→B1→B2→C1→C2→C3. Los100 archivos coinciden con la evidencia de su último propietario;63 son aplicación,32 pruebas/fixtures y cinco SQL solo locales. Los archivos compartidos se incluyen una sola vez en su versión final actual. [Manifiesto](manifest.json).

El candidato es el árbol público de la base más el delta declarado, sus referencias/documentación y los futuros SQL definitivos aún no creados. No basta copiar solo los100 archivos: Dockerfiles/manifests/archivos inalterados de la base también son dependencias. No construir desde un directorio con env reales o incorporar cambios nuevos del checkout S01 por sincronización automática.

`payloadSha256` usa SHA256 del JSON compacto UTF8 de las entradas ordenadas por ruta: `{path,sha256:workingSha256,bytes}`. Cada entrada conserva hash de trabajo y hash normalizado LF, bytes, blob de base si existe y evidencias históricas. El hash no es un SHA de commit Git. Las constantes documentales que describen su propio candidato no se incluyen de forma autorreferente en ese hash; su revisión se registra aparte.

## SQL y catálogo

Orden local ya probado:001–047→A foundation→A permisos→B1 marcas/mapeos→B2 preparación/admisión→C asociaciones/evidencia. Los cinco archivos exigen marcadores de ensayo y frescura; son insumos de diseño, **no migraciones remotas**. No se reservan048 u otros números por preparar. El catálogo real determina los nombres/ordinales y la materialización final de funciones/RLS/grants; drift o overload inesperado se revisa, nunca se corrige con reemplazos amplios o reejecución de030/046/047.

[catalog-preflight.sql](catalog-preflight.sql) es una única ejecución de inventario, encerrada en transacción READ ONLY con timeout15s/lock2s y ROLLBACK. Solo catálogos PostgreSQL y conteos agregados de mail_accounts/outbox/messages; no ejecuta funciones de producto. Devuelve roles/esquemas, owner/RLS/privilegios de tabla y columna, huellas de funciones/vistas/políticas/constraints/triggers/índices, contexto del operador y presencia de ledger. Nunca devuelve correos, IDs de cuenta/caso, mensajes, claves, rutas de archivos o cuerpos SQL. Los conteos no asignan ni confirman marcas.

[Referencia sintética](expected-catalog.json): base47 frente a baseABC en PGlite. Sirve para comparar las400 diferencias de objetos de catálogo esperadas, no400 nuevas funciones. Owners, versión del motor, identidad SQL y conteos de legado son contextuales: no exigir igualdad con postgres de PGlite ni declarar conforme por una huella global. Revisar cada definición/permiso relevante y cualquier diferencia/objeto extra; Postgres puede renderizar definiciones de forma distinta. `migration_history_present` no acredita historial; si existe, primero identificar sus columnas y leer lo necesario bajo permiso de diagnóstico propio.

La consulta requiere un operador con alcance completo de catálogo y lectura no filtrada por RLS para esos agregados. `read_only=on` obligatorio; si faltan roles/objetos o sql_role_bypassrls/sql_role_superuser y privilegios suficientes, clasificar inventario incompleto y detener promoción. No usar una clave service_role para saltarse ese gate.

## Artefactos e infraestructura existentes

Web: Dockerfile multi-stage, Node22-alpine/pnpm11.19, usuario crm no-root, standalone, puerto3000 y GET /api/health. Worker: Dockerfile.worker, mismo runtime/dependencias, producción con tsx y heartbeat `/tmp/crm-worker-heartbeat`. .dockerignore excluye `.env*` salvo ejemplo, `.local`, `.git`, node_modules/.next/logs. El worker no copia docs/tests; el web final copia standalone/static/public. Las capas de build tampoco deben recibir secretos por otras vías.

No cambia ningún Dockerfile/config. Base Node por major sin digest es una limitación ya existente; registrar el digest de las imágenes finalmente construidas para recuperación. Health devuelve estado del proceso, no prueba schema/MFA/ACL. Se necesitan versión y QA funcional del conjunto.

No variables nuevas. Revalidar únicamente presencia/ubicación de las existentes de web y worker: build NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY; runtime APP_ORIGIN/SUPABASE_SERVICE_ROLE_KEY/INTEGRATION_ENCRYPTION_KEY/GOOGLE_OAUTH_ORGANIZATIONS y modos Gmail/heartbeat ya establecidos. No rotar o copiar valores. INSTANTLY_WEBHOOK_ENABLED deberá seguir ausente o false; no crear secretos S00 para publicar esta versión. Ninguna variable habilita Composio en este paquete.

## Transición y recuperación

Los recursos reportados son web «CRM CURRATADED», worker «curated-worker», dominio crm.finlabinc.com y main. Último healthy reportado fb9f201 en ambos; imagen recuperable actual/control de autodeploy del worker no acreditados. Un push a main dispara al menos la web. No asumir que pulsar Stop en worker impide que el autodeploy lo vuelva a iniciar.

Se necesita una ventana coordinada: inventariar y detener productores/despachos afectados mediante mecanismo verificado, aplicar SQL final aprobado, publicar lectores/escritores compatibles, revisar marcas/membresías/cuentas reales mediante MFA y solo después reanudar lo autorizado. No rellenar marcas por dominio/M1/M2 ni continuar automáticamente cola vieja. Los mensajes sending/uncertain conservan su intento/Message-ID; conciliarlos sin otro POST.

Rollback de imagen previo no restaura compatibilidad por sí solo. B2 cierra el antiguo recheck booleano y mark_sent requiere la nueva admisión; el código base fb9f201 no implementa todo ese protocolo. Probar matriz viejo/nuevo SQL y web/worker en QA, con despachos detenidos, y preferir corrección hacia adelante o versión compatible que conserve restricciones. Nunca restaurar021, borrar historia/revisiones o volver a abrir grants. Recuperación/preservación de datos e imagen se deben acreditar antes del permiso remoto; no se crea ni ejecuta respaldo aquí.

Se reutilizan [ADR de separación de evidencia/escritor](../integration/block-c/adr-004-evidencia-sin-selector.md) y [transición de integración](../integration/rollout.md). No se toma una decisión nueva de arquitectura o corte productivo.
