# PRM-FINAL-r1 — corrección acotada 048

01/11/2026 · SDD STRICT · preparación del SQL definitivo solicitada tras VR1. **No autorizado para ejecución remota.** [Protocolo](protocol.md), [verificación](verification.md), [contrato](release-contract.json), [huella de locks](lock-footprint.json), [manifiesto y hashes](manifest.json).

## Alcance confirmado

Se mantienen los FR/AC del [plan PRM](../spec.md) y su matriz: 28 relaciones públicas, anon sin acceso, authenticated SELECT en 23, CRUD en mail_drafts/mail_recipient_selections y ninguno en tres internas Gmail. service_role, funciones/defaults, RLS/policies, vistas, Storage y datos no se modifican. VR1 aclaró las tres vistas y no se repite. No nuevas preguntas de negocio: las decisiones restantes son técnicas; respaldo/ventana/concurrencia son precondiciones pendientes para ejecutar, no supuestos de hechos ya acreditados.

El coordinador reserva **048** en este paquete local. La carpeta de migraciones contiene 001–047; el árbol público revisado de S01 termina en 045, sus propuestas no reservan 048. No se consultó el remoto ni se infiere historial a partir del número. Ante otra reserva/048 remota o cualquier cambio concurrente, detener promoción y coordinar antes de usar el ordinal.

El archivo definitivo revisable [048_restore_scoped_public_permissions.sql](048_restore_scoped_public_permissions.sql) se conserva aquí para no incorporarlo a descubrimiento/aplicación automática ni romper los fixtures base47. Solo se copiará **byte a byte** a supabase/migrations/048_restore_scoped_public_permissions.sql en la publicación coordinada autorizada, con su hash. Hoy no se añade migración a esa carpeta ni se hace push/commit/deploy. No editar 001–047 o sustituir A/B/C por esta corrección.

## Diseño de finalización

Se deriva del candidato local ya probado, conservado intacto. La versión final retira únicamente la guarda exclusiva de fixture; mantiene actor supabase_admin/superuser, versiones PG compatibles, allowlist, transacción SERIALIZABLE, timeout de sentencia 15s/lock 2s y aborto ante drift. No hay GRANT, CASCADE, alteración de defaults, DML de negocio o UDF nueva.

Refuerzos antes del primer REVOKE: contrato de columnas/tipos/typmod/notNull de las 28 relaciones, las tres huellas crudas de vistas ya aceptadas (variantes sintéticas PG18 y recibidas PG15), ACL humanas exclusivamente directas del owner, sin columna/PUBLIC/grant option/herencia, y privilegios de PG15 conocidos. El fixture PG18 normaliza únicamente MAINTAIN —inexistente en PG15— antes de probar este artefacto; la migración final aborta si detecta ese privilegio inesperado en roles humanos, en vez de ampliar la corrección.

La huella recursiva de relaciones bloqueables se valida antes de tomar locks; se adquieren ACCESS EXCLUSIVE en orden determinista sobre los objetivos y se vuelve a validar el contrato bajo lock. Las vistas pueden bloquear relaciones subyacentes que no reciben REVOKE. La lista exacta queda en el contrato, no se amplía en runtime. No se matan sesiones ni se para el worker por suposición.

La evidencia de preservación compara metadata lógica, ACL no humanas, columnas, funciones, policies, defaults, membresías/flags de roles, ACL de esquemas y Storage. En Storage se excluyen estadísticas físicas volátiles de pg_class, conservando owner/RLS/options/ACL y huellas de columnas/constraints/índices/triggers. No se hacen hashes de filas reales: las pruebas de conservación de filas son solo en fixtures ficticios.

El recibo `pipeline_os_prm1_application` se emite **antes del COMMIT**, con huellas before/after y estado `checked_before_commit`: no es prueba de commit por sí solo. Exigir éxito del script completo y después el [postflight de lectura](postflight.sql), cuya huella de preservación debe coincidir con el recibo. Una respuesta perdida no autoriza reenviar; usar solo el postflight autorizado para conciliar o detenerse.

SERIALIZABLE/locks en una sesión PGlite no prueban carreras entre conexiones. Se conserva el gate de validación independiente de contención y exclusión operativa de DDL/DCL para la aplicación real. No se convierte en PASS por preparar SQL final, ni se piden escrituras de ensayo en producción por la autorización de VR1 ya consumida. El protocolo separa este pendiente de la preparación local terminada.

## Trazabilidad y entrega

| T / FR–AC                       | Cierre previsto en este incremento                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| PF-T01 / FR01/02/06, AC01/02/06 | SQL 048 exacto y contrato finito, derivados sin editar fuentes aceptadas; ordinal local revisado.             |
| PF-T02 / FR02/04/05, AC02/04/05 | Precondiciones, footprint, recibo y postflight de lectura; vistas aceptadas preservadas.                      |
| PF-T03 / FR01–06, AC01–06       | Ensayos locales exclusivos del delta final, hashes, enlaces y auditoría. No repetir las 42 pruebas aceptadas. |
| PF-T04 / FR05, AC05             | Runbook con respaldo, ventana, autorizaciones separadas, resultados e incertidumbre/recuperación.             |

Ningún cambio de modelo exige tipos generados, UI o build nuevo; ADR de arquitectura no aplica: misma DB/actores/flujo. Se documenta la transición técnica de candidato protegido a artefacto final; no se introducen nuevos permisos o decisiones de negocio.

Presupuesto de aplicación propuesto: **1 script correctivo con preflight interno + 1 postflight READ ONLY**, cero retries. Solo si la sesión queda abierta/abortada se propondrá además **1 ROLLBACK condicional**, explícitamente autorizado: dos scripts normales, máximo tres con limpieza. VR1 y PD-R1 ya consumidos no se repiten. Un cambio de condiciones o ensayo remoto adicional requeriría alcance/presupuesto separado; no está incluido. Instantly 43/0 nuevas.
