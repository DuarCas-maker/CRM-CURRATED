# Candidato CAPP047-20261029-r1

**Registro local autorizado posteriormente:** [R47-T04a, cierre y serialización Git](instantly-047-local-commit.md), con [manifiesto Git-LF](instantly-047-commit-manifest.json). El commit que incorpora ese cierre identifica la versión definitiva local sobre esta base; conserva los20 archivos probados y el manifiesto original como snapshot de preparación. Publicación/push/deploy/smoke/activación no autorizados por crear el commit.047 ya aplicada por operador: no repetir.

**Evidencia posterior a la preparación:** operador confirma flag ausente, muestra imagen0af77b7 en ejecución/retención2/mecanismo Rollback y, tras autorización SQL específica, reporta047 Success con postflight conforme. [Constancia y huellas046/047](../verification.md). R47-T03 completada para aplicación reportada y catálogo;046 conserva sus huellas. No altera el payload o autoriza publicación; el manifiesto de versión conserva su snapshot de preparación. Commit final y permisos de publicación/smoke siguen pendientes; no repetir047.

29/10/2026. **Preparado localmente, sin commit nuevo ni publicación.** [Runbook](instantly-047-release-runbook.md), [manifiesto de contenido](instantly-047-release-manifest.json), [QA del puente](instantly-c-app-validation.md). No es un manifiesto de ensayo C ni un permiso de ejecución.

## Alcance de la versión

Base Git `0af77b7ce3baa0d46b0dd2e7e553dd88c230a150`, rama local `codex/s00-auto-receive`. Se conservan todos los cambios públicos pendientes del coordinador: puente/UI/API/control, migración 047, CLI/v9, tests/fixture, inventario de migraciones y documentación S00/raíz de continuidad. La constancia de despliegue anterior se incluye como evidencia histórica; no implica repetir ese despliegue. Sin selección o incorporación del worktree S01.

El manifiesto fija cada archivo de código/SQL/prueba que cambia respecto a la base con SHA-256 y tamaño. `payloadSha256` es SHA-256 del JSON compacto UTF-8 de la lista `payload` ordenada por ruta (claves file/sha256/bytes, sin salto final); no es un commit, tag o digest de imagen. La documentación de apoyo se enumera por ruta fuera de esa huella para evitar autorreferencia; también debe revisarse al crear el commit definitivo. La migración tiene además su SHA independiente en el manifiesto. No se exportan hashes/IDs privados de campañas, cuentas, fuente operativa o credenciales.

El manifiesto se valida contra los archivos actuales y contra la copia de fuentes públicas que pasó QA. Cambiar cualquier archivo del payload invalida esta revisión; requiere candidato y checks pertinentes actualizados. El commit que finalmente se apruebe debe corresponder al payload y contener la documentación revisada. No inventar ahora un SHA de commit futuro ni modificar HEAD/índice para simular publicación.

## Revisión y validación

- Comportamiento: publicación apagada; routes de lease/control y callback no acceden a auth/DB con flagfalse. El control añade permisos técnicos temporales; no campañas, leads, correos o negocio.
- Seguridad/datos: grant superadmin activo/MFA/origen, ticket opaco hash-only, scopes/cuotas/TTL y cierre/revocación. 047 aditiva sobre 046; RLS y RPC backend. Errores y evidencia sanitizados; CLI/journal privados no llegan a la imagen web.
- Compatibilidad: cambios en helper Supabase y fábricas conservan defaults; C original mantiene comportamiento por defecto. Admisión 047 se inyecta en la ruta real futura; requiere SQL antes de activar. Sin dependencias, cambios de config/Docker/worker o arquitectura nueva.
- QA existente del mismo payload: **681/681**, 25 nuevas; aceptación DB001–047, TypeScript y build Next16/Turbopack aislado. Esta preparación comprueba huellas y prueba el catálogo del runbook; no atribuye esas 681 a una ejecución nueva.
- Límites materiales: imagen Docker/Linux no construida localmente, tag Node22-alpine mayor sin digest, runtime/SQL/PostgREST/TLS/MFA/descarga del navegador no certificados por el build Windows. Los gates de publicación/configuración y C real permanecen separados.

## Ficha para autorización posterior

El dominio/recurso y 0af77b7 saludable provienen de la evidencia anterior, no de consultas actuales. La referencia `origin/main` leída hoy es local/cacheada; antes de push se debe consultar el remoto y comprobar compatibilidad bajo el permiso de publicación. Faltan commit final, imagen/despliegue previo recuperable, estado actual de flag, catálogo 047 remoto y aprobaciones SQL/publicación/smoke. No son bloqueos para preparar este candidato; sí para ejecutar el runbook.

Se conserva la decisión del usuario de avanzar con datos de prueba sin respaldo ni borrado. Recuperación propuesta: recuperar la revisión/imagen saludable identificada, con flagfalse y esquema/evidencia 046/047 conservados; sin restaurar contadores o ejecutar reversa SQL remota.

## Cierre local

Auditoría local: los20 archivos del payload coinciden con la copia que pasó681/681, DB/TS/build; huella conjunta `a84dbab9de4a4ebdaaff9e7dd766ee89c3be0d94cf3f9ac9401d74ed3bf8bff9`. SHA047 `7a3cc068d3216e558d97cb240cd326496fa49324b627f9ee9bbe11e457662559`, también en el manifiesto. Consulta del runbook9/9 escenarios correctos en PGlite descartable; formato/enlaces/diff revisados. No se repiten suites/build del producto porque su código no cambió.

Las43 peticiones y12 JSON operativos conservan sus hashes; HEAD0af77b7 e índice sin cambios preparados/staged. Selección pública sin archivos `.env` reales, `.local` o S01; revisión con patrones de secretos de alta confianza sin coincidencias (no sustituye una auditoría integral). No se crean secretos/ventanas/tickets/journal v9 reales. No hay commit, push, tag, despliegue, SQL remoto o activación por este candidato. Metadatos actuales de publicación y permisos siguen pendientes según el runbook.
