# Implementación local PRM1 / VR1

01/11/2026 · SDD STRICT. El usuario autorizó PRM-T03/04 offline sobre el plan anterior. Clarificación cerrada por ese plan, la matriz y las migraciones: no hay decisión de negocio nueva. Sin transporte de red, SQL remoto, cambios de aplicación o ordinal definitivo.

## Ventana y decisiones técnicas

- Añadir `scripts/pipeline-os/permission-remediation.ts`, `view-fingerprint.ts`, un fixture y un test nuevos. Conservar intactos producto, PD-R1, sus tests y las 47 migraciones.
- Generar `permission-correction.local.sql` y `view-review.sql` de forma reproducible; el primero exige el marcador externo `pipeline_os.prm1_mode=offline_fixture_only`. No proporciona comando de ejecución ni elimina la guarda para producción. No crear UDF, tablas auxiliares o migración numerada.
- PRM1: transacción SERIALIZABLE, timeouts, bloqueos ACCESS EXCLUSIVE sobre la allowlist y validación de las 28 relaciones antes de revocar. Comparar metadatos protegidos y ACL no humanas antes/después. Abortar ante PUBLIC, herencia de roles humanos, columnas con ACL, owner/grantor/tipo/seguridad o derechos legítimos inesperados. Solo REVOKE del exceso; sin CASCADE, GRANT, cambio de defaults o EXECUTE.
- Los locks y SERIALIZABLE son defensa local, **no acreditación de carreras con otra conexión**. El SQL final requerirá exclusión operativa de DDL/DCL durante la ventana y validación de contención independiente antes de autorizar escritura real. No se simula concurrencia real con una sesión PGlite.
- VR1: solo tres vistas, BEGIN READ ONLY/ROLLBACK y `standard_conforming_strings=on`. Contexto final `search_path=pg_catalog, pg_temp`: catálogos primero y temporal explícitamente al final, evitando la búsqueda temporal implícita anterior a pg_catalog. Mismo contexto para referencia/comparación, incorporado en el scope/hash. Una tabla temporal pg_class se prueba sin poder redirigir PRM1/VR1. Metadata de columnas/seguridad, hashes no pretty y huella léxica. No ampliar esta lectura a las 28 ACL: PRM1 hace su preflight fresco dentro de la transacción correctiva futura.
- Lexer compartido en contrato JS/SQL: palabras ASCII sin comillas a minúsculas, espacios exteriores ignorados; cadenas e identificadores entre comillas conservados byte a byte. Operadores, casts y orden se preservan. Comillas con escapes especiales, comentarios, dollar quoting, formatos no soportados, truncamiento o límites excedidos significan `incomplete`, nunca equivalencia.
- El comparador valida estructura estricta, tamaños, claves únicas, scope y contexto antes de contrastar. No exporta cuerpos SQL o errores de entrada. No confundir igualdad de tokens con equivalencia SQL arbitraria, estado remoto fresco o aprobación de publicación.

## Trazabilidad de QA

PRM-AC01/02: matriz exacta, repetición, permisos humanos positivos/negativos, dueño/ajeno/superadmin, servicio preservado, fallo a mitad con rollback y drift previo abortado. PRM-AC03: defaults, funciones y Storage inalterados y control de CREATE/grants en una sola transacción ficticia. PRM-AC04: consulta reproducible/read-only, igualdad JS/SQL del lexer, literales/identificadores/operadores distintos detectados, casos no soportados y alteración de cada vista detectada. PRM-AC05/06: CLI sin ejecutar/red, entradas saneadas y auditoría de preservación.

Pruebas con PGlite instalado y base 001–047/datos ficticios. Esto no demuestra ejecución nueva en PG15 ni carreras reales; la excepción previa PD-R1 fue solo lectura y no autoriza estos DCL en producción. Mantener presupuesto propuesto: una lectura VR1, un script correctivo y una lectura postflight, con autorizaciones separadas y sin retries. Instantly 43/0 nuevas.
