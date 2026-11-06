# CAPP-REL: publicar el puente y 047 con entrada apagada

**Smoke posterior autorizado y completado:** [R47-T05a6/6 correctas](instantly-047-app-smoke.md), health/login200 y webhook/trial/control/lease404 vacíos/no-store con headers previstos.43 conservadas,0 Instantly/SQL/envíos/activación/deploy; permiso6 consumido sin retries. R47-T05 manual/retención y C siguen pendientes; no volver a ejecutar los pasos HTTP históricos con esa autorización.

**Publicación posterior autorizada:** [fb9f201 en main verificado; Coolify Success/Finished/healthy confirmado por operador](instantly-047-publication.md). R47-T04 completada con límites de esa evidencia; no repetir push/deploy/047 por los pasos históricos siguientes. R47-T05/smoke y C real permanecen pendientes,43 conservadas y sin activación o envíos.

**Commit local autorizado como incremento separado:** [cierre R47-T04a](instantly-047-local-commit.md) y [serialización Git-LF](instantly-047-commit-manifest.json). El commit que contiene ese cierre fija el candidato para futura aprobación de publicación. No hereda permiso de push/deploy o smoke;047 ya aplicada/postflight conforme, sin repetir SQL. Los apartados de preparación siguientes son cronológicos.

**Estado posterior del operador:**047 autorizada/aplicada por usuario con Success y postflight conforme; tabla/constraints/RLS/grants/cuatro funciones correctas, owner supabase_admin, helper privado y046 con tres huellas conservadas. [Resultado y baseline](../verification.md). R47-T03 completada para aplicación reportada/catálogo, sin ejecución RPC en vivo o publicación del código. Flag ausente e imágenes/retención ya observados; no se hizo rollback. La ficha y secuencia originales siguientes conservan la preparación y no implican repetir047. Commit/publicación/smoke/activación continúan pendientes de su permiso.

29/10/2026, America/Bogota. **SDD STRICT, preparación local**. La solicitud actual autoriza preparar la versión/runbook y validarlos offline. No autoriza Git remoto, commit de publicación, despliegue, SQL remoto, cambios de variables, activación, grants, pruebas C o mensajes. [Implementación y QA](instantly-c-app-validation.md), [contrato CAPP](instantly-c-app-bridge.md), [candidato](instantly-047-release-candidate.md), [manifiesto de versión](instantly-047-release-manifest.json).

## Requisitos, aceptación y tareas

| FR / tarea         | Resultado verificable                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R47-FR01 / R47-T01 | Preservar código validado, cambios locales, fuente 43 y 12 JSON. R47-AC01: huellas del payload coinciden con la copia que pasó QA; no se leen `.env`, modifica índice/HEAD o contacta el remoto.                |
| R47-FR02 / R47-T02 | Identificar candidato, destino y anterior recuperable. R47-AC02: contenido y SHA de 047 registrados; commit futuro/imagen/recurso y flag actual se confirman antes de publicar, con aprobación específica.      |
| R47-FR03 / R47-T03 | Instalar únicamente 047 sobre 046 aceptada. R47-AC03: catálogo previo sin objetos 047 y posterior con tabla/RLS/grants/RPC/owner esperados; consulta probada en PGlite. Objetos parciales o deriva bloquean.    |
| R47-FR04 / R47-T04 | Publicar apagado en la app existente. R47-AC04: revisión aprobada saludable, flag ausente/false y sin credenciales del ejecutor en el servidor; ningún worker, servicio, DNS, puerto o plan nuevo.              |
| R47-FR05 / R47-T05 | Validar publicación y disponer de recuperación sin pérdida. R47-AC05: smoke limitado y evidencias separadas; conservar 046/047 y diario al recuperar la revisión anterior. C/D/S00 no se cierran por desplegar. |

R47-T01/02 y la preparación/documentación local de T03–05 se realizan ahora. La ejecución de T03 depende de autorización SQL; T04 de T03 y aprobación de publicación; T05 de T04 y permiso de smoke. No se marca el despliegue completado por preparar esta guía. Se reutilizan 9→A, el alcance del puente ya acordado y la decisión de conservar datos sin respaldo; no hay nueva elección de arquitectura o proveedor.

## Ficha y precondiciones

| Dato             | Evidencia / pendiente antes de ejecutar                                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidato        | `CAPP047-20261029-r1`, contenido fijado en el manifiesto; todavía sin commit nuevo, etiqueta, imagen o publicación.                                                                                                                                                                                        |
| Base             | `0af77b7ce3baa0d46b0dd2e7e553dd88c230a150`; HEAD y referencia local `origin/main` coinciden. No se hizo fetch/ls-remote hoy; no demuestra el estado remoto actual.                                                                                                                                         |
| App              | `https://crm.finlabinc.com`, instalación existente. Última confirmación humana: despliegue de 0af77b7 Success; MFA y tres vistas abren. No se vuelve a comprobar por red hoy.                                                                                                                              |
| Coolify          | Según captura previa: v4.5.3, Root Team → CRM - CURRATED → production → CRM CURRATADED. Rama main/autodeploy confirmados. El operador debe comprobar recurso web, nombre exacto, dominio, última revisión e imagen recuperable actuales; no seleccionar worker ni cambiar build pack.                      |
| Supabase         | Instancia existente `https://supabase.finlabinc.com`, proyecto `default`. Catálogo 046 proporcionado por usuario, owner `supabase_admin`; 047 remota desconocida. Confirmar que sigue siendo esa instancia antes del SQL.                                                                                  |
| Recuperación     | 0af77b7 es la última revisión saludable reportada, no una imagen inspeccionada hoy. Registrar identificador de despliegue/imagen y mecanismo real de recuperación en Coolify; no asumir que «Redeploy» recupera el anterior: podría reconstruir el main nuevo.                                             |
| Flag             | Última confirmación: `INSTANTLY_WEBHOOK_ENABLED` ausente. Verificar que continúe ausente o `false` en runtime web **antes** de SQL/publicación. Si está true o es incierto, detenerse; no cambiarlo sin autorización.                                                                                      |
| Datos / respaldo | El usuario decidió continuar con datos mayormente de prueba, conservarlos y no hacer respaldo. Esta preparación no crea ni exige uno nuevo. 047 es aditiva, sin backfill, borrado o restauración; revertir código conserva el esquema/evidencia. Si el destino ya no corresponde al autorizado, detenerse. |
| Aprobaciones     | Pendientes: catálogo remoto, aplicación 047, commit/push del candidato concreto que disparará Coolify y smoke. La autorización pasada de 0af77b7 no se reutiliza.                                                                                                                                          |

Metadatos de ejecución a registrar luego: operador/fecha, catálogo previo/posterior, SHA del archivo aplicado, commit publicado, imagen y despliegue anteriores/nuevos, flag comprobado y resultados de smoke. Solo metadatos, sin valores de variables, tokens, cookies, enlaces de consentimiento o registros de clientes.

## Secuencia propuesta — no ejecutada

1. **Congelar y revisar contenido.** Contrastar el manifiesto y la QA del candidato. Cualquier cambio de código/047 invalida su huella y exige revisión/pruebas pertinentes. No incluir `.local`, `.env` reales, adjuntos privados o trabajo S01. Mantener sin cambios 046, manifests/lockfile, Dockerfiles y worker.
2. **Verificar destino y reversión con el operador.** Completar los metadatos pendientes de la ficha y comprobar flag apagado sin guardar cambios. Conservar una revisión/imagen saludable recuperable antes de publicar. Ni este acceso al panel ni su tráfico quedan ejecutados por esta guía.
3. **Autorizar preflight SQL.** Con permiso explícito, ejecutar únicamente la consulta de catálogo siguiente en la instancia confirmada. Esperar 046 completa, roles presentes, owner/privilegios de lectura de perfiles viables y ningún objeto 047. Si hay objetos 047, detener la instalación: pueden ser una aplicación anterior o parcial; comparar evidencia/definiciones, sin DROP ni repetición de CREATE. No usar el catálogo como historial de migraciones.
4. **Aplicar una única 047 autorizada.** Verificar su SHA-256 contra el manifiesto. Abrir un snippet nuevo en SQL Editor y ejecutar el archivo completo `supabase/migrations/047_instantly_webhook_control_leases.sql`, desde `begin` hasta `commit`, sin añadir 046 u otras migraciones. Usar la cuenta propietaria confirmada (se espera `supabase_admin`, no imponer `postgres`). Si falla, conservar el error sanitizado y parar; no adaptar permisos/funciones manualmente ni reintentar a ciegas. Un `Success` sin postflight no acredita el contrato.
5. **Postflight SQL autorizado.** Repetir exactamente la consulta de catálogo. Verificar los resultados de la sección siguiente y que los objetos 046 no han cambiado respecto al preflight. Si el resultado es incierto o no conforme, no publicar. Esta consulta no emite permisos, arma ventanas o prueba RPC vía HTTP.
6. **Registrar el commit a publicar.** Tras aprobación específica del candidato, crear/revisar el commit local con selección explícita de archivos públicos; comprobar árbol, pruebas y ausencia de secretos. Registrar el SHA definitivo y su relación con la huella del manifiesto. Antes de push, consultar el estado remoto bajo ese permiso y comprobar ascendencia; si main cambió, detenerse a revisar integración, sin force/reset/stash/clean o merge automático. No reescribir commits ajenos.
7. **Publicar una sola vez, apagado.** Tras autorización del commit/destino y SQL conforme, publicar mediante el flujo Git acordado a main del repositorio conectado. El push dispara Coolify; no pulsar además Deploy/Redeploy. No desplegar el worker o cambiar variables. Esperar resultado, registrar commit e imagen reales y revisar logs sanitizados. Success, Running o un 404 aislados no bastan para acreditar la revisión exacta.
8. **Smoke autorizado y aceptación humana.** Ejecutar como máximo los seis HTTP sin credenciales de la sección de presupuesto. Con permiso separado para acceso humano, entrar con MFA y consultar Oportunidades/lista/detalle, Conversaciones, Campañas e Integraciones; no importar autorización ni pulsar «Autorizar este ensayo». La tarjeta técnica puede estar visible a superadmin activo, pero sus endpoints deben permanecer apagados. Registrar solo vista/estado/error sanitizado.
9. **Entregar publicación apagada.** Mantener 43. No generar un manifiesto ejecutable, nonce/ventana real, credencial, journal v9 o webhook del proveedor como parte de la publicación. Preparar C real en un bloque posterior con autorización, cuota y configuración propias; no activar true para probar que «funciona» el release.

## Consulta de catálogo propuesta, solo lectura

**No ejecutada remotamente.** No llama a los RPC ni lee filas de negocio, trials o leases. Solo catálogos y privilegios. Puede copiarse antes/después; ambos pasos requieren autorización futura.

```sql
begin transaction read only;
with roles_wanted(name) as (
  values ('anon'),('authenticated'),('service_role')
), tables_wanted(name,version) as (
  values ('instantly_webhook_trials',46),('instantly_webhook_receipts',46),
         ('instantly_webhook_control_leases',47)
), tables_meta as (
  select w.*,c.oid,c.relkind,c.relrowsecurity,c.relowner
  from tables_wanted w left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=w.name
), functions_wanted(signature,version,exposed) as (
  values ('public.instantly_webhook_trial_read(text)',46,true),
    ('public.instantly_webhook_trial_prepare(text,jsonb,text,uuid,uuid)',46,true),
    ('public.instantly_webhook_trial_cas(text,integer,jsonb)',46,true),
    ('public.instantly_webhook_control_snapshot(text)',47,false),
    ('public.instantly_webhook_control_issue(uuid,text,jsonb,text,uuid,uuid,text,uuid)',47,true),
    ('public.instantly_webhook_control_execute(text,text,text,text,uuid)',47,true),
    ('public.instantly_webhook_control_admit(text)',47,true)
)
select jsonb_build_object(
 'inventory_kind','047_catalog_only_not_migration_history',
 'sql_role',current_user,
 'roles',(select jsonb_agg(jsonb_build_object('name',w.name,'present',r.oid is not null) order by w.name)
   from roles_wanted w left join pg_roles r on r.rolname=w.name),
 'tables',(select jsonb_agg(jsonb_build_object(
   'name',t.name,'version',t.version,'present',t.oid is not null,'kind',t.relkind,
   'rls',t.relrowsecurity,'owner',pg_get_userbyid(t.relowner),
   'policy_count',(select count(*) from pg_policy p where p.polrelid=t.oid),
   'columns',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
     where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select jsonb_agg(jsonb_build_object('name',con.conname,'kind',con.contype,
     'definition',pg_get_constraintdef(con.oid)) order by con.conname)
     from pg_constraint con where con.conrelid=t.oid),
   'access',(select jsonb_agg(jsonb_build_object('role',w.name,
     'select',has_table_privilege(r.oid,t.oid,'SELECT'),
     'insert',has_table_privilege(r.oid,t.oid,'INSERT'),
     'update',has_table_privilege(r.oid,t.oid,'UPDATE'),
     'delete',has_table_privilege(r.oid,t.oid,'DELETE'),
     'truncate',has_table_privilege(r.oid,t.oid,'TRUNCATE'),
     'references',has_table_privilege(r.oid,t.oid,'REFERENCES'),
     'trigger',has_table_privilege(r.oid,t.oid,'TRIGGER')) order by w.name)
     from roles_wanted w left join pg_roles r on r.rolname=w.name)
   ) order by t.name) from tables_meta t),
 'functions',(select jsonb_agg(jsonb_build_object('signature',w.signature,'version',w.version,
   'backend_exposed',w.exposed,'present',p.oid is not null,'owner',pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef,'settings',p.proconfig,
   'definition_md5',case when p.oid is not null then md5(pg_get_functiondef(p.oid)) end,
   'public_execute',case when p.oid is not null then exists(
     select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
     where acl.grantee=0 and acl.privilege_type='EXECUTE') end,
   'execute',(select jsonb_agg(jsonb_build_object('role',rw.name,
     'allowed',has_function_privilege(r.oid,p.oid,'EXECUTE')) order by rw.name)
     from roles_wanted rw left join pg_roles r on r.rolname=rw.name)
   ) order by w.signature) from functions_wanted w
     left join pg_proc p on p.oid=to_regprocedure(w.signature)),
 'unexpected_control_overloads',(select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'instantly_webhook_control_%'
     and not exists(select 1 from functions_wanted w where to_regprocedure(w.signature)=p.oid)),
 'profiles_owner_context',(select jsonb_build_object('present',c.oid is not null,
   'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'sql_role_select',has_table_privilege(current_user,c.oid,'SELECT'),
   'sql_role_superuser',r.rolsuper,'sql_role_bypassrls',r.rolbypassrls)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
     join pg_roles r on r.rolname=current_user
   where n.nspname='public' and c.relname='profiles')
) as s00_047_catalog;
rollback;
```

Interpretación necesaria:

- Antes: dos tablas y tres firmas 046 completas, coherentes con el catálogo aceptado; tabla y cuatro firmas 047 ausentes; roles presentes. No sobreescribir objetos existentes o parciales.
- Después: tabla 047 `kind=r`, RLS=true, policies=0 intencionalmente, owner esperado `supabase_admin`; los siete privilegios directos de cada rol deben ser false. Columnas exactas: id, trial_id, actor_id, token_hash, intent_id, issued_at, expires_at, revoked_at, normal, reserve, emergency, observations, admissions, arm_attempted, close_attempted, revoke_attempted, attempts.
- Constraints 047: PK id; únicos trial_id/token_hash/intent_id; FK trial_id→trials y actor_id→profiles, ambas RESTRICT; controles de hash, plazo >0/≤10 minutos, N1–19/R0–4/H0–2, total≤25, observaciones≤12, admisiones≤16 y array de intentos≤24/longitud=total−1. Comparar definiciones con el archivo revisado, sin limitarse al número de constraints.
- Las cuatro funciones 047 deben ser SECURITY DEFINER, owner esperado y `search_path=""`; PUBLIC/anon/authenticated execute=false. **El helper snapshot también tiene service_role=false**. Solo issue/execute/admit y las tres RPC 046 permiten service_role=true. Ninguna sobrecarga adicional.
- El propietario de 047 necesita leer perfiles. Con owner `supabase_admin`, confirmar SELECT y acceso compatible con RLS (propietario con bypass de RLS aplicable o rol superuser/bypassrls). Si el ejecutor es otro rol o el contexto no permite determinarlo, detener y revisar; no otorgar permisos abiertos por ensayo.
- Los hashes de definición 046 antes/después deben permanecer iguales en la misma instancia. El MD5 es una huella de catálogo, no el SHA-256 del archivo ni prueba de aplicación histórica. Diferencias de versión PostgreSQL pueden cambiar la representación frente a PGlite; no comparar hashes entre motores sin revisión.
- Un catálogo correcto **no prueba** exposición/caché de esquema PostgREST, grant HTTP con MFA, recepción ni concurrencia del proxy. No ejecutar funciones técnicas «para verificar» durante el despliegue apagado. Si posteriormente PostgREST no reconoce RPC, diagnosticar bajo permiso separado, sin `NOTIFY`/reinicios o cambios de esquema implícitos.

## Configuración de publicación apagada

Reutilizar el recurso web existente. No cambiar Dockerfile, build pack, DNS, TLS, puerto 3000 o volúmenes por este incremento. El código guarda recibos en Supabase; no requiere un volumen nuevo para el bridge. El runtime de la imagen web contiene las rutas Next; el CLI/journal permanecen en este computador, no se copian al VPS para ejecutarlos.

| Variable                                                           | Tratamiento                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INSTANTLY_WEBHOOK_ENABLED`                                        | Ausente o `false` en runtime web. Las rutas nuevas responden 404 antes de auth/DB. No habilitar para smoke.                                                                                           |
| `APP_ORIGIN`                                                       | Conservar origen canónico `https://crm.finlabinc.com`. Las rutas comprueban exactamente ese origen; el grant exige Origin/MFA. No introducir otra dirección.                                          |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Reutilizar los valores existentes de Build y Runtime; no pedirlos ni cambiarlos.                                                                                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`                                        | Ya configurada, solo runtime backend. No exponer al navegador, CLI, JSON o build.                                                                                                                     |
| `INSTANTLY_S00_WEBHOOK_SECRET` / `INSTANTLY_S00_WEBHOOK_DEDUP_KEY` | No son necesarias con flagfalse. Configuración/confirmación privada futura antes de C; dos secretos independientes, sin valores en la documentación. No crearlos o rotarlos al publicar apagado.      |
| `INSTANTLY_S00_CONTROL_TOKEN`                                      | **Nunca configurar en Coolify, worker o Build.** Token temporal futuro, solo en el proceso local del ejecutor tras grant humano. No copiar la API key ni secretos existentes para usarla como ticket. |

`.dockerignore` excluye `.local`, `.env*` reales, `.git`, node_modules y artefactos locales; `.env.example` es público. El Dockerfile conserva Node22-alpine, pnpm11.19.0/frozen lockfile, multi-stage/standalone, usuario crm no-root y healthcheck. La base Node usa tag mayor, no digest inmutable: no se cambia por esta preparación, por lo que no se declara build Linux byte-a-byte reproducible. Compose incluye web/worker, pero su existencia no demuestra que Coolify despliegue ambos; no ejecutar compose aquí.

## Presupuestos y aceptación posterior

**Hoy: 0 HTTP reales, 0 SQL remoto; Instantly continúa en 43.** Las pruebas del catálogo se ejecutan solo en memoria local y no consumen cupo del proveedor.

Propuesta futura de publicación: dos ejecuciones SQL de metadatos (pre/post), una ejecución de 047, una publicación/autodeploy y **hasta seis HTTP cliente a la app** para smoke. Estas operaciones requieren sus autorizaciones; no se suman como peticiones Instantly. El tráfico del SQL Editor, login/MFA/navegación, assets, builds, healthchecks y logs es adicional y no tiene aquí un techo de infraestructura prometido.

Usar nonce ficticio `000000000000000000000000`, sin cuerpo/token/cookies; origen HTTPS canónico, redirects deshabilitados y sin retries. Una vez por fila:

| #   | Petición propuesta                                                             | Esperado con flagfalse                                      |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | GET `/api/health`                                                              | 200 y JSON exacto status=ok/service=curated-crm.            |
| 2   | GET `/login`                                                                   | 200 HTML de acceso; no enviar formulario desde el ejecutor. |
| 3   | POST vacío `/api/integrations/instantly/webhook/000000000000000000000000`      | 404, vacío/no-store; sin DB.                                |
| 4   | GET `/api/integrations/instantly/trials/000000000000000000000000`              | 404, vacío/no-store; sin DB.                                |
| 5   | GET `/api/integrations/instantly/control/000000000000000000000000`             | 404, vacío/no-store; sin DB.                                |
| 6   | POST vacío `/api/integrations/instantly/trials/000000000000000000000000/lease` | 404, vacío/no-store; sin auth/DB/grant.                     |

Comprobar headers de protección existentes (nosniff/DENY/CSP) y ninguna redirección inesperada. Ante cualquier resultado distinto, detenerse; no seguir redirects, repetir consultas, iniciar sesión técnica o activar true como diagnóstico. Registrar estados y checks, sin guardar HTML completo, cookies o headers privados. Cruzar siempre con revisión/imagen: rutas no presentes en una imagen vieja también pueden responder 404.

La futura C real mantiene propuesta independiente: proveedor **hasta19 nuevas/62 acumuladas**, control **hasta25 nuevas**, máximo44 API cliente nuevas; autenticación/backend/entregas contabilizados aparte según contrato. **No autorizadas por este runbook**. No usar el remanente5 de B, los antiguos permisos de C o el smoke para ejecutar la CLI.

## Detención y recuperación

Si faltan roles/046, existe 047 parcial, el SHA difiere, owner/ACL/search_path no coinciden o SQL falla: detener antes de publicación. No DROP, reejecución ciega, políticas abiertas, cambios de owner o restauración de base/diario.

Si falla build/arranque o hay regresión tras publicar: mantener la entrada apagada y preservar logs sanitizados. Recuperar la imagen/revisión saludable **previamente identificada**, bajo autorización concreta de recuperación. No asumir que Redeploy de main vuelve a 0af77b7 y no hacer un push de reversa improvisado. Si no hay artefacto anterior recuperable, resolver ese gate antes del release.

Conservar las tablas/funciones 046/047 y cualquier evidencia: son expansivas y el código anterior con flagfalse puede coexistir con ellas. No ejecutar down migration remota, borrar leases/recibos, campañas, leads, mensajes o volúmenes ni restaurar contadores. La reversa local se probó solo en una base descartable.

## Verificación de esta preparación

Consulta de catálogo comprobada offline: **9/9 escenarios correctos** (base sin roles/objetos,046,047 bajo owner supabase_admin, contexto de ese owner, privilegio directo indebido, helper expuesto, sobrecarga adicional, RLS desactivada y función faltante). Se detectan las derivas y se conserva046/perfiles en la base descartable; cero HTTP reales/SQL remoto.

Huellas de20 archivos del payload iguales a la copia QA; SHA047 en el manifiesto,43/12 JSON preservados y HEAD/índice sin mutaciones de esta preparación. Se reutiliza la evidencia **681/681/DB/TS/build** del payload implementado; no se presenta como una suite repetida por escribir documentos. Formato/enlaces/diff y selección pública revisados. R47-T01/02 y la preparación local de T03–05 terminadas; ejecución remota/G6 y C no completados. Docker Linux, catálogo remoto, imagen recuperable, flag actual, publicación y seis HTTP siguen sin verificar/ejecutar.
