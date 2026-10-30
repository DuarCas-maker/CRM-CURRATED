# INS-REL: preparación de 046 y despliegue existente

**Siguiente incremento preparado:** [runbook047 del puente de control](instantly-047-release-runbook.md). 046 ya tiene evidencia de aplicación/publicación; no repetirla al instalar047. La guía siguiente conserva la preparación histórica de046.

**Continuación posterior autorizada:** [publicación0af77b7 y validación de app](app-deployment-validation.md). Migración aplicada por usuario/catálogo posterior conforme; main publicado/verificado, deploy Success reportado por operador, smoke4/4 apagado correcto.43 conservadas, sin C/envíos/activación; aceptación autenticada/logs aún pendientes. La preparación y las tablas de estado siguientes se conservan como antecedente, no como estado actualizado de ejecución.

29/10/2026, America/Bogota. **Planificación SDD STRICT; no ejecutado en remoto.** Skills spec-driven-development, production-deployment y supabase-engineer. Extiende [INS-APP](instantly-app-integration.md), sin cambiar su implementación o permisos. No autoriza push, merge, SQL remoto, configuración en vivo, build, despliegue, pruebas HTTP ni activación de Instantly.

## 1. Objetivo y contexto confirmado

Publicar posteriormente el webhook técnico dentro de la app existente, conservando sus datos y dejando la entrada deshabilitada. El usuario confirma en la pregunta3: **Coolify usa main y el despliegue automático está activado**. Un push/merge a main puede publicar; no usarlo como paso de preparación. No cambiar ese ajuste ahora.

Al iniciar esta preparación, el checkout codex/s00-auto-receive tenía cambios previos y archivos sin registrar; su HEAD aún no representaba INS-APP. Preparar una versión coherente/revisada antes de cualquier publicación, sin descartar cambios ajenos ni incluir secretos. S01 conserva su worktree y alcance según [coordinación](../parallel-development.md).

Actualización posterior: respuesta5→B autoriza preparar y revisar una **versión conjunta con todos los cambios públicos pendientes**, no solo el webhook. [RC: alcance y evidencia](release-candidate.md) registra el candidato y su QA. La instrucción original de no hacer commit/build por esta guía queda como antecedente; esta nueva solicitud permite preparación/build aislado y registro local, conservando la prohibición de push/merge/despliegue/SQL remoto.

La migración [046](../../../../supabase/migrations/046_instantly_webhook_trials.sql) es aditiva/transaccional: dos tablas técnicas, tres RPC, RLS y grants; no altera leads, campañas ni worker. No contiene IF NOT EXISTS: **no repetirla para comprobar si estaba aplicada**. SHA256 del archivo revisado: `3e820cf5fb087a645bbaa91c8c37205df069d8b076aee96ad1385dd36cebed81`. Recalcular antes de aplicar si el archivo cambia y revisar cualquier diferencia.

No hay registro remoto de migraciones acreditado por el inventario previo; un catálogo de objetos acredita presencia, no el historial completo ni igualdad del SQL. No aplicar001–045, reset, semillas o scripts de instalación sobre la instancia existente.

## 2. Requisitos y aceptación

| FR       | Requisito                                                                 | AC verificable                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-FR01 | Preparar sin mutaciones o tráfico real y conservar el ensayo.             | REL-AC01: journal v7/calls43 y12 JSON privados idénticos;0 nuevas llamadas, sin migración remota, push/merge/build/deploy o cambios S01.                                                                          |
| REL-FR02 | Controlar el despliegue automático de main mediante una versión revisada. | REL-AC02: registrar commit candidato, commit/imagen anterior, recurso/dominio y aprobación antes de publicar; ningún push preparatorio a main.                                                                    |
| REL-FR03 | Aplicar únicamente046 una vez, con privilegios y catálogo comprobados.    | REL-AC03: preflight ausente → aplicación transaccional autorizada → dos tablas con RLS/acceso directo denegado y tres RPC restringidas; objetos previos o deriva detienen la instalación.                         |
| REL-FR04 | Reutilizar la app y configuración existentes con entrada apagada.         | REL-AC04: imagen del commit aprobado, flag ausente/false, variables privadas solo runtime web; sin otro servicio/DNS/worker/puerto/volumen, sin copiar .local o env reales.                                       |
| REL-FR05 | Separar publicación, smoke y prueba C; conservar rollback sin pérdida.    | REL-AC05: presupuestos/autorizaciones separados, health200 y webhook404 son smoke limitado; ante fallo se conserva evidencia/esquema y se recupera imagen previa autorizada; C/D/S00 no se cierran por desplegar. |

REL-AC01 se comprueba hoy; AC02–05 son criterios para la ejecución futura, no resultados remotos. No se cambian requisitos de negocio ni se introduce una arquitectura nueva; se mantiene IA-ADR01.

## 3. Ficha de la publicación futura

Completar esta ficha con metadatos del panel antes de solicitar la ejecución. No pegar secretos, enlaces privados de consentimiento ni variables con valores reales.

| Dato                  | Estado                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entorno               | Instancia existente autorizada por el usuario para pruebas; confirmar que el recurso seleccionado sigue siendo ese destino.                                                                                                      |
| Supabase Studio       | https://supabase.finlabinc.com; misma instancia de los inventarios/030; destino no consultado hoy.                                                                                                                               |
| Coolify               | Aplicación web del CRM ya conectada; nombre/proyecto exactos por registrar desde el panel.                                                                                                                                       |
| Dominio               | Dominio actual de la app y APP_ORIGIN existente; por confirmar coincidencia, sin abrir env reales aquí.                                                                                                                          |
| Rama / automatización | main / automático, confirmado por el usuario; no modificado.                                                                                                                                                                     |
| Versión candidata     | Código conjunto63686c6 registrado localmente y constancia documental posterior; ver RC. No publicado; ficha remota/build Linux pendientes.                                                                                       |
| Versión anterior      | Commit e imagen/despliegue saludable actual por registrar; comprobar que Coolify permite recuperarlo.                                                                                                                            |
| Ventana y aprobación  | Pendientes para migración, publicación y smoke; el permiso actual solo prepara.                                                                                                                                                  |
| Respaldo              | No realizado. El usuario pidió conservar los datos de prueba y avanzar sin respaldo; no se ejecuta ni exige crearlo en esta preparación. Si el destino cambia a producción efectiva, revisar sus condiciones antes de autorizar. |

Artefactos locales revisados: Dockerfile web Node22/standalone/nonroot/puerto3000/health, .dockerignore excluye .local y env reales, compose conserva web/worker separados. La configuración activa de Coolify, imagen, TLS, logs y privilegios remotos no están verificados por leer estos archivos. No crear una segunda aplicación ni asumir que Coolify usa compose por existir compose.yaml.

## 4. Pasos propuestos, en orden

**Hoy no ejecutar ninguno de los pasos remotos siguientes.** La siguiente interacción puede completar la ficha leyendo el panel, sin guardar cambios. Las consultas SQL y los smoke también necesitan autorización posterior: no son parte de las43 llamadas ya consumidas.

1. **Identificar la app existente.** En Coolify, seleccionar el recurso web del CRM y anotar nombre/proyecto, dominio, rama main, automatización y última versión saludable. Distinguirlo del worker. No pulsar Save/Deploy/Redeploy ni cambiar toggles. Registrar qué mecanismo permite recuperar la imagen previa sin publicar código pendiente por accidente.
2. **Preparar la versión local.** Revisar el diff completo y los archivos nuevos de INS-APP, sus dependencias y cambios S00 anteriores; excluir .local, credenciales y trabajo S01. Mantener los cambios actuales. Revisar pruebas para el candidato concreto; el resultado previo423/423 no acredita automáticamente un commit futuro. No hacer commit/push/merge por esta guía. El build de release sigue pendiente y se deberá validar en un contexto controlado, sin carga automática de env reales o llamadas de build no presupuestadas.
3. **Autorizar y comprobar el catálogo remoto.** Confirmar instancia/cuenta SQL propietaria postgres y ejecutar únicamente la consulta de metadatos de la sección5 cuando esté autorizado. Antes de046 deben faltar las dos tablas y las tres firmas; roles anon/authenticated/service_role deben existir. Si hay objetos parciales o completos, detenerse: no DROP, no ejecutar la046 encima ni inferir su historial por el mensaje Success.
4. **Aplicar046, una sola vez, después de autorización.** Abrir un snippet nuevo en el SQL Editor de la instancia confirmada. Copiar el contenido completo del archivo046 revisado, desde begin hasta commit; no fragmentos ni otras migraciones. Ejecutar como propietario postgres. Si falla, conservar el error sanitizado; no cambiar permisos o SQL a mano ni repetir sin diagnóstico. No publicar el código mientras el resultado sea incierto.
5. **Validar el resultado SQL.** Repetir la consulta de catálogo autorizada: esperar dos tablas/columnas, RLS=true, propietario esperado, sin acceso directo para los tres roles; tres RPC SECURITY DEFINER con search_path vacío, execute solo service_role entre esos roles. Un resultado distinto bloquea el despliegue. Guardar evidencia de metadatos, fecha/operador/huella046, sin filas de clientes. Esto no acredita todavía disponibilidad RPC por PostgREST.
6. **Publicar el candidato autorizado.** Con046 aceptada, ficha y versión anterior registradas, revisar en Coolify que el flag esté ausente o false; cualquier cambio de variables/reinicio también requiere autorización. Solo entonces publicar el commit aprobado a main mediante el flujo Git autorizado: puede iniciar el build/despliegue automáticamente. No pulsar además Deploy/Redeploy para duplicarlo. Esperar el resultado y verificar que la revisión desplegada coincide. Si falla, parar y diagnosticar sin ciclos de reintento o ajustes de infraestructura no autorizados.
7. **Smoke limitado, solo cuando se autorice.** Consultar health y entrada deshabilitada según sección7; revisar el estado de despliegue/logs sin cuerpos, tokens o headers privados. Comprobar acceso/login de la app con el operador si se autoriza; detener ante regresión. Registrar cada resultado real y la revisión. No habilitar la bandera ni preparar/armar un ensayo como parte del smoke.
8. **Entregar publicación apagada y preparar C aparte.** Mantener43. Resolver manifiesto ligado a esa fuente, puente CLI→control DB, secretos, persistencia/TLS/logs y presupuesto integral antes de autorizar una prueba C. No reutilizar el antiguo techo19/62 o el remanente5 de B. No crear webhooks en Instantly, activar campañas, enviar correos o verificar leads por desplegar.

## 5. Catálogo propuesto de solo lectura

**No ejecutado en Supabase remoto.** La misma consulta se propone antes/después; no consulta filas de negocio, manifiestos, IDs de campañas, recibos ni secretos. Si faltan roles, las comprobaciones de privilegios devuelven null y se detiene el procedimiento. El resultado no demuestra igualdad de definiciones de funciones ya existentes.

```sql
begin transaction read only;
with tables_wanted(name) as (
  values ('instantly_webhook_trials'), ('instantly_webhook_receipts')
), tables_meta as (
  select w.name, c.oid, c.relrowsecurity, c.relowner, c.relkind
  from tables_wanted w
  left join pg_namespace n on n.nspname = 'public'
  left join pg_class c on c.relnamespace = n.oid and c.relname = w.name
), functions_wanted(signature) as (
  values ('public.instantly_webhook_trial_read(text)'),
         ('public.instantly_webhook_trial_prepare(text,jsonb,text,uuid,uuid)'),
         ('public.instantly_webhook_trial_cas(text,integer,jsonb)')
), roles_wanted(name) as (
  values ('anon'), ('authenticated'), ('service_role')
)
select jsonb_build_object(
  'inventory_kind', '046_catalog_only_not_migration_history',
  'sql_role', current_user,
  'roles', (select jsonb_agg(jsonb_build_object(
    'name', w.name, 'present', r.oid is not null
  ) order by w.name) from roles_wanted w
    left join pg_roles r on r.rolname = w.name),
  'tables', (select jsonb_agg(jsonb_build_object(
    'name', t.name, 'present', t.oid is not null, 'kind', t.relkind,
    'rls', t.relrowsecurity, 'owner', pg_get_userbyid(t.relowner),
    'columns', (select jsonb_agg(a.attname order by a.attnum)
      from pg_attribute a where a.attrelid = t.oid
        and a.attnum > 0 and not a.attisdropped),
    'access', (select jsonb_agg(jsonb_build_object(
      'role', w.name,
      'select', has_table_privilege(r.oid, t.oid, 'SELECT'),
      'insert', has_table_privilege(r.oid, t.oid, 'INSERT'),
      'update', has_table_privilege(r.oid, t.oid, 'UPDATE'),
      'delete', has_table_privilege(r.oid, t.oid, 'DELETE')
    ) order by w.name) from roles_wanted w
      left join pg_roles r on r.rolname = w.name)
  ) order by t.name) from tables_meta t),
  'functions', (select jsonb_agg(jsonb_build_object(
    'signature', w.signature, 'present', p.oid is not null,
    'owner', pg_get_userbyid(p.proowner),
    'security_definer', p.prosecdef, 'settings', p.proconfig,
    'execute', (select jsonb_agg(jsonb_build_object(
      'role', rw.name,
      'allowed', has_function_privilege(r.oid, p.oid, 'EXECUTE')
    ) order by rw.name) from roles_wanted rw
      left join pg_roles r on r.rolname = rw.name)
  ) order by w.signature) from functions_wanted w
    left join pg_proc p on p.oid = to_regprocedure(w.signature))
) as s00_046_catalog;
rollback;
```

Después de046, columnas esperadas de trials: id, nonce, manifest, manifest_hash, workspace_id, campaign_id, revision, armed_at, deadline, closed, created_at. De receipts: trial_id, ordinal, digest, payload_digest, received_at, context_validated, classification, duplicate. No comprobarlo abriendo registros reales. La tabla sin políticas es intencional: acceso solo mediante RPC concedidas al backend, además de RLS/grants restrictivos. No añadir políticas abiertas para resolver un error.

## 6. Variables y configuración de la app web

| Variable                                                       | Preparación del despliegue apagado                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INSTANTLY_WEBHOOK_ENABLED                                      | Ausente o false. No guardar true por desplegar.                                                                                                                                                                                          |
| APP_ORIGIN                                                     | Ya existente, origen HTTPS canónico de la misma app, sin ruta o slash final. Comprobar coincidencia privadamente; no sustituir por otro dominio.                                                                                         |
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY       | Configuración pública de build ya existente; preservar. No poner claves de servicio aquí.                                                                                                                                                |
| SUPABASE_SERVICE_ROLE_KEY                                      | Secreto backend runtime ya existente; preservar, no pedirlo de nuevo.                                                                                                                                                                    |
| INSTANTLY_S00_WEBHOOK_SECRET / INSTANTLY_S00_WEBHOOK_DEDUP_KEY | No son necesarias mientras la bandera esté apagada. Antes de C: dos secretos diferentes de64 hex minúsculas, solo runtime web, sin exponerlos en chat/build/NEXT_PUBLIC o logs. Prepararlos/configurarlos requiere su alcance posterior. |

La ruta apagada no necesita INSTANTLY_API_KEY, credenciales Composio ni archivos de este computador. No subir s00.env, journals, manifiestos privados, adjuntos o .local al VPS. No cambiar variables del worker.

## 7. Presupuesto y aceptación posterior

Hoy: **0 peticiones nuevas;43 acumuladas conservadas**. La guía no habilita tráfico. Aplicar SQL y hacer Git/deploy son operaciones separadas, no llamadas Instantly; tampoco quedan autorizadas por ese contador.

Smoke manual mínimo futuro propuesto: **2 peticiones HTTP a la app,0 a Instantly**, sin redirecciones ni reintentos automáticos: GET /api/health →200 y JSON del servicio; POST vacío a /api/integrations/instantly/webhook/000000000000000000000000 →404 con flagfalse, sin token ni DB. Usar el origen HTTPS canónico confirmado. Si aparece redirección/error, parar; no seguir URLs automáticamente. Los healthchecks de Coolify/Docker y tráfico normal del navegador son adicionales y no forman un cupo total de infraestructura. El inventario SQL antes/después se autoriza aparte.

Un404 por sí solo puede corresponder a una versión antigua: contrastar el commit/imagen y resultado del build. Health200 solo indica que la app sirve HTTP; **no acredita RPC, autenticación de callback o recepción**. Verificar la entrega real y controles con flagtrue pertenece a C y requiere presupuesto de app/DB/proveedor nuevo; el anterior19/62 no se amplía por esta guía. Costos globales del proveedor/servidor no medidos; ninguna compra/cambio de plan propuesto.

## 8. Fallos y rollback propuestos

- Objetos046 ya presentes/parciales, roles faltantes, catálogo inesperado o error SQL: detener antes de publicar; comparar metadatos/definiciones y resolver mediante revisión, sin borrar objetos ni repetir la migración ciegamente.
- Build fallido o revisión distinta: no activar el webhook, no forzar despliegues repetidos; conservar la versión saludable y evidencia del error.
- Regresión de login/health/funciones existentes: recuperar la imagen/despliegue previo conocido mediante el mecanismo Coolify previamente comprobado y autorizado; evitar un nuevo push a main como rollback improvisado. Mantener flagfalse. Si no hay versión recuperable, no autorizar la publicación todavía.
- La046 es expansiva: al volver al código anterior, conservar sus tablas/RPC/evidencia. No ejecutar reversa destructiva, borrar datos, restaurar/resetear Supabase, reiniciar contadores ni tocar campañas para revertir el código. La reversa probada anteriormente solo fue PGlite descartable.

## 9. Tareas y verificación

| T       | Objetivo / trazabilidad                   | Dependencias                                    | Terminado cuando / comprobación                                                                                        | Estado                              |
| ------- | ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| REL-T01 | Preparación/runbook; FR01–05.             | INS-APP offline, respuesta3.                    | Secuencia, catálogo, gates, rollback y presupuesto documentados; formato/enlaces/preservación locales.                 | Preparada; ver evidencia de cierre. |
| REL-T02 | Candidato reproducible y ficha; FR02/04.  | T01.                                            | Commit/diff/imagen anterior/destino registrados, checks/build del candidato revisados antes de permiso de publicación. | Pendiente; sin Git mutante/build.   |
| REL-T03 | Preflight/aplicación/postflight046; FR03. | T02, destino y autorización SQL.                | Catálogo y huella antes/después conformes; una única aplicación, evidencia sanitizada.                                 | Pendiente; no remoto.               |
| REL-T04 | Publicación apagada; FR02/04.             | T03, aprobación del candidato/Git/deploy.       | Revisión correcta saludable en el recurso existente, flagfalse.                                                        | Pendiente; no push/merge/deploy.    |
| REL-T05 | Smoke/evidencia; FR01/05.                 | T04, permiso de2 HTTP y revisión de logs/panel. | Resultados reales y versión registrados, journal43 intacto; límites de smoke explícitos.                               | Pendiente; sin HTTP.                |

QA previa de implementación:423/423 regresión,19 casos nuevos, aceptación DB001–046, TypeScript/formato correctos; no se inventa una ejecución nueva de esas suites por preparar documentación. Build/imagen/TLS/SQL remoto siguen pendientes. El cierre actual registra comprobaciones documentales y preservación; no declara G6, C, D o S00 completos.

### Evidencia de esta preparación

Consulta del apartado5 probada sin red en PGlite en memoria: **4/4 escenarios correctos** (sin roles/objetos, roles sin046,046 aplicada con permisos esperados y catálogo parcial). Se comprobó propietario postgres, RLS, search_path vacío, ausencia de acceso directo y execute limitado a service_role. La instancia desechable se cerró; no hubo SQL remoto o HTTP real. Esto verifica la consulta propuesta, no el catálogo del servidor.

Auditoría local: **43/v7,12 JSON operativos y410 archivos previos protegidos idénticos**; huella046 intacta. Seis documentos revisados,216 enlaces locales válidos,5 FR/5 AC/5 tareas presentes. Prettier y git diff --check correctos. Solo se crea este runbook y se actualizan sus referencias en cinco documentos; no se modifica código, migraciones, Docker/configuración, env reales, índices Git o el worktree S01. REL-T01 completada para preparación local; REL-T02–05 siguen pendientes. No se certifican costos globales, recepción, publicación o cierre de S00.
