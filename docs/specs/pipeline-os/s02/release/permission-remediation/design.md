# Diseño PRM1 y VR1

**Implementado después de este diseño:** [decisiones técnicas y ventana](implementation-design.md), [evidencia offline](implementation-verification.md). Este documento conserva la propuesta original. La implementación ya existe; no confundir los futuros de esa propuesta con tareas todavía sin realizar. VR1 no se ejecutó realmente. Exclusión de DDL/DCL concurrente y verificación de contención siguen siendo gates antes de escribir en producción.

## PRM1: revocar exclusivamente el exceso

Cada entrada de permissions-matrix.json tiene objeto/tipo, objetivo anon/authenticated, privilegios extra observados, grantor y evidencia de migraciones/consumidores. No es una migración ni una lista para pegar en Studio. Referencia válida para producción previa a ABC: 001–047 y los campos/grants explícitos del repositorio; no copiar el estado real con sus defaults amplios como objetivo.

El futuro candidato local tendrá marcador de ensayo/frescura y precondiciones: 28 relaciones presentes/tipo esperado; owner/grantor supabase_admin; RLS en tablas y security_invoker en vistas sin cambios; legítimos SELECT/CRUD ya presentes; grants excedentes únicamente directos a anon/authenticated, sin grant option. Identificadores y roles exactos de allowlist; no SQL de entrada del usuario. Ante falta de derechos legítimos, PUBLIC/herencia/grants de columna no previstos, otro creador o drift, abortar antes de cambiar nada.

Por relación/rol se revocan únicamente operaciones de `(observado − objetivo)`; no se emiten GRANT para ampliar derechos faltantes. SELECT se conserva en 23 relaciones, CRUD en mail_drafts/mail_recipient_selections y ningún acceso en las tres tablas internas Gmail. Los grants de service_role/postgres/supabase_admin, función/rol propietario, membresías y Storage no se cambian. Las 329 diferencias de acceso a columnas derivan de tabla en la evidencia recibida: no hacer 329 correcciones de columna ni quitar los grants de columna legítimos que A/I02 incorpora en otras relaciones.

Una transacción, lock_timeout 2s y statement_timeout 15s con orden determinista por objeto/rol; ante fallo rollback completo, sin CASCADE o retry automático. Mantener todos los objetos/datos/IDs/policies/SECURITY DEFINER/triggers intactos. La serialización final debe asegurar que ninguna otra sesión DDL puede invalidar el preflight entre comprobación y DCL; decidir/probar locks necesarios al implementar, con timeout y sin parar el worker por suposición. La autorización futura debe identificar el SQL exacto, destino y ventana.

PRM1 no depende de cambiar predicates o columnas de las tres vistas: deja definiciones y SELECT legítimo intactos. Sí requiere que su contrato de acceso y security_invoker siga presente. A/B/C no se publica hasta resolver los gates propios. El DCL aislado no implica push/deploy o activación; no se programa un reinicio automático de web/worker.

## Conservación funcional y consumidores

- `src/app/api/mail/route.ts` usa userClient/requireUser y upsert de mail_drafts con comprobación can_mail_case; preservar CRUD y policies de dueño/caso.
- `src/app/api/mail/recipient-selections/route.ts` consulta/upsert bajo la sesión del usuario y condiciones de propiedad, según 040; preservar CRUD y RLS, sin permitir ver selecciones ajenas.
- `src/lib/server/workspace.ts` consume vistas de oportunidades/tareas/campañas con el cliente de usuario y SELECT. Preservar columnas/orden/nombres y errores de acceso.
- `worker/db.ts` crea cliente service_role. `worker/gmail-sending-usage.ts` lee/escribe gmail_sent_usage con ese cliente; sus derechos no se quitan. Gmail API slots/usage son usadas por funciones de presupuesto/servicio de 039, no darles SELECT humano para sortear una prueba.

Los listados de consumidores son evidencia estática de menciones, no prueba de todos los flujos. Antes de materializar, revisar en cada caller si db es userClient/serviceClient; no asumir rol por estar en un archivo de servidor. Ninguna llamada real es necesaria para esta revisión.

## Defaults y las 70 funciones

PRM1 excluye cambios de defaults y EXECUTE. function-inventory.json conserva 70 firmas y evidencia literal/SQL, diferenciando las que carecen de literal `.rpc` sin calificarlas de no usadas. La ausencia de mención no detecta despacho dinámico, triggers o llamadas SQL indirectas. Resolver callchains/rol/contexto antes de proponer revocación de service_role; nunca igualar automáticamente el fixture, que omite defaults de plataforma.

Para el incremento final A/B/C, la creación de cada nuevo objeto público debe establecer grants explícitos en la misma transacción, con PUBLIC/anon/authenticated rechazados salvo contrato positivo. Se debe probar con los defaults amplios observados, no solo en un fixture vacío. Si existe una ventana entre CREATE y REVOKE por commits separados, el gate falla.

Posible PRM2, **fuera de la primera corrección**: reducir defaults de relaciones/secuencias para creador supabase_admin/esquema public después de confirmar consumidores y grants explícitos de objetos futuros. No afectar storage/auth/otros creadores. Los defaults actuales no acreditan la historia de objetos existentes ni sus cambios corrigen grants ya instalados.

Para funciones, el default builtin/global puede conceder EXECUTE a PUBLIC; un REVOKE por esquema no revoca lo concedido globalmente. No presentar quitar los grants anon/authenticated de defacl public:f como cierre total, ni proponer GLOBAL sin inventariar creaciones fuera de public. La mitigación concreta aprobable para funciones nuevas es control de privilegios por función/commit. Mantener diferenciado «control de creación» y «modificación permanente de defaults».

## VR1: revisión de tres vistas mediante una lectura futura

Las seis dependencias adicionales coinciden con la huella del descriptor `relation:<vista>:0`, usando la misma fórmula de PD-R1. Clasificación: self_relation_metadata_matches; no son seis dependencias nuevas a datos ajenos. Se conservan como prueba de metadata y no equivalencia semántica.

Para la definición vigente de producción:

| Vista              | Fuente vigente                                 | Comportamiento a preservar                                                                                                  | Consumidor                                                   |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| campaign_workspace | 043_campaign_first_contact, después de 029/039 | Columnas explícitas de campaña, count de enrollments, campaign_delivery_stats y first_contact/selección/horario/activación. | workspace/campañas; no sustituir por la definición local B2. |
| opportunity_inbox  | 024_reply_engagement, sobre 007                | EXISTS conversación de la oportunidad con inbox_activated_at IS NOT NULL.                                                   | Inbox/consultas de oportunidades e indicadores.              |
| opportunity_tasks  | 007_history                                    | EXISTS tarea de la oportunidad con status open.                                                                             | workspace con view=tasks.                                    |

`block-b/migrations/b-brand-delivery.local.sql` ya redefine campaign_workspace para el futuro B2. Esa fuente no es la expectativa de producción PD-R1 y no se usará para «arreglar» la vista real por adelantado.

Contrato propuesto VR1: BEGIN READ ONLY, search_path=pg_catalog, timeout 15s/lock 2s, un SELECT con salida `pipeline_os_abc_view_review`, ROLLBACK. Allowlist exacta de tres vistas. Hash del scope/protocolo, contexto y presencia/opciones de seguridad/columnas/tipos de salida, ACL de lectura y metadata de dependencias sin OIDs inestables. No devolver pg_get_viewdef, expresiones, nombres de clientes o filas. No llamar campaign_delivery_stats o cualquier función de producto para probar la vista.

Comparar huellas de `pg_get_viewdef(oid,false)` cruda/LF y un fingerprint de tokens conservador de la definición, con cobertura léxica completa, count y hash de literales/identificadores entre comillas. Normalizar solo espacios fuera de literales y case de tokens no entrecomillados; conservar orden, paréntesis, casts, nombres, operadores y valores. Concatenar tokens con longitud/separadores inequívocos, nunca borrar espacios con regex global o dentro de strings. Soportar únicamente formas validadas por los fixtures; escape/dollar quoting/símbolo no soportado produce unsupported/incomplete. No instalar un parser ni crear una UDF en la base para leer el catálogo.

La futura implementación debe usar exactamente el mismo tokenizer/protocolo/contexto para referencia local y lectura SQL PG15 y demostrar equivalencia con tests de literales, escapes, operadores y tokens separados. No afirmar que un lexer prueba equivalencia relacional arbitraria: igualdad de tokens conservadores más columnas/flags/dependencias es evidencia de misma definición salvo formato. Si no coincide o no hay cobertura completa, clasificar unresolved y no recrear la vista. El objetivo de esta preparación es el contrato; no hay lexer, SQL VR1 o pruebas de ese componente implementados hoy.

El resultado VR1 puede incluir metadata fresca de las 28 ACL/precondiciones ya delimitadas para evitar repetir todo PD-R1; solo hashes/flags/grants, sin más clientes/APIs. Si se desea ampliar el scope deberá justificarse antes de autorizar la consulta. La salida anterior no se transforma como si tuviera nuevas huellas o contexto fresco.

## QA local y secuencia operativa

Implementación posterior: candidato PRM1 fuera de supabase/migrations y VR1/validador offline. Fixtures descartables con base 001–047, roles/defaults/grants amplios reproduciendo la metadata conocida; usuarios dueño/ajeno/superadmin, sin datos reales. Mutaciones de QA solo en memoria; CR-001 de PD no autoriza escrituras reales ni las requiere para estos ensayos.

Escenarios: preflight exacto; drift de owner/grantee/column ACL; fallo intermedio y atomicidad; repeat idempotente; anon sin derechos y sin TRUNCATE por chequeo de privilegios; SELECT/CRUD legítimo; RLS del usuario ajeno; worker/service sin pérdida; vistas/Storage/EXECUTE/defaults/datos inalterados; futuros objetos A/B/C con defaults amplios y grants explícitos. Simular llamadas, sin red, importaciones/adjuntos/verificaciones/envíos. Para comprobar permisos SQL reales en fixture se puede usar roles sintéticos; nunca SET ROLE o DML en producción por este plan.

Después de QA, presentar una ejecución READ ONLY VR1; ante error detener y conservar salida saneada, no retry automático. Cerrar vistas o registrar residual. Materializar ordinal final con coordinación del repo y permisos SQL del destino, sin reutilizar 048 por intuición. Aplicación eventual: transacción del SQL exacto aprobado y lectura postflight acotada de las 28 ACL más hashes protegidos. Cada autorización conserva alcance separado; no implica publicar A/B/C.

## Recuperación

Antes de COMMIT, cualquier precondición fallida revierte la transacción completa. Después de COMMIT no restaurar automáticamente el estado excesivo anon/TRUNCATE ni ejecutar GRANT ALL como rollback. Conservar evidencia y corregir hacia adelante solo una operación legítima documentada/QA/aprobada si se confirma una regresión. No tocar datos/IDs/Instantly ni imágenes de app como si revirtieran grants. Verificar recuperación en fixture antes de proponer aplicación real. Preparar archivos se puede deshacer por selección propia, sin reset del WIP.
