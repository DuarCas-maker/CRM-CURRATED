# Ajustes del instalador y permisos productivos — STRICT

17/11/2026. Mismo alcance de publicación autorizado. No cambia la lógica del editor ni los datos de clientes.

## Delimitadores SQL del instalador

Primer intento: HTTP 400 a las 18:02 UTC aproximadamente, sin nuevas tablas/esquema/RPC persistidos. No se repitió a ciegas. Inspección read-only confirmó ausencia y huellas idénticas de las dos colas; validación read-only del guard individual correcta; ensayo del SQL original con ROLLBACK en el destino correcto también pasó.

Causa reproducida localmente: el parámetro de reemplazo de `String.replace` interpreta `$$` como un único `$`; al prefijar el bloque DO de comprobación mediante una cadena, alteraba sus delimitadores antes de enviarlo. Se cambió por callback en `scripts/lender-composer-release-plan.mjs`. El mismo generador se ejecuta ahora en el test PG15 nativo, incluyendo migración completa, guardas y smoke de publicación. Se añadió verificación explícita de los delimitadores.

Se conservaron `migration-attempt.json`, inspección, diagnóstico y el intento corregido `migration-retry-attempt.json`. SQL 056 original sin cambios: d4e3098daf29e2bf4e8f353355a18725c71dd4ba1b30af100239c633fd4ba589. Reintento verificado aplicado a las 18:07:51 UTC.

## Grants predeterminados de Supabase

Postflight de 056: las tablas nuevas tenían RLS activo, pero los privilegios predeterminados del entorno daban SELECT a anon y DML a authenticated. Las políticas limitaban el acceso; el contrato exige también ACL mínima explícita. No se publicó la web en ese estado ni se guardaron datos de clientes.

Se agregó **057_lender_template_grants.sql**, sin editar la migración 056 ya aplicada. Revoca privilegios de public/anon/authenticated únicamente sobre las dos tablas nuevas y vuelve a conceder SELECT a authenticated y ALL a service_role. No modifica los defaults globales ni los permisos de otras tablas.

El test PG15 reproduce esos defaults antes de 056, confirma el comportamiento y aplica 057. Postflight productivo: anon_select=false, auth_select=true, auth_update=false, RLS=true en ambas tablas. RPC administrativa denegada a anon; ACL de colas, can_send y catálogo ajeno sin cambios respecto al preflight fijado. La prueba SQL ROLLBACK confirmó CRUD/versiones, idempotencia, CAS, archivo, 73 targets, escritura directa bloqueada y MFA/inactividad bloqueados, sin outbox ni proveedor.

Para huellas comparables se fija search_path=pg_catalog,public,pg_temp en el preflight/postflight y el instalador; se conserva el preflight inicial sin fijación como antecedente. Ninguna huella de datos o registros personales se almacena.
