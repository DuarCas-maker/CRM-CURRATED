# VR1 — tres vistas aclaradas

01/11/2026 · Revisión SDD del resultado aportado por el operador. **Las tres definiciones coinciden dentro del alcance VR1**, sin otra ejecución remota o modificación de vistas. [Resultado trazable](vr1-result-review.json), [transcripción canónica](vr1-observed-canonical.json), [comprobaciones de conservación](vr1-result-checks.json).

## Contexto y autorización

El usuario autorizó una sola ejecución READ ONLY en el Supabase self-hosted del CRM y aportó el JSON de `pipeline_os_abc_view_review`. Contexto informado: PostgreSQL 150008, supabase_admin, READ ONLY on, search_path pg_catalog, pg_temp y standard_conforming_strings on. objectsOk true, tres vistas completas, 83 columnas; scope coincide con el SQL autorizado.

SQL SHA256: `dcd3f067310e1ca4c6d9965853d4f76757b2aef08a96bceb6cbf58c3fa128a35`.

Scope SHA256: `72df8f3480d7779879ebcf373008d3df8d7746c3bc0a0c2109dfd25b8d6279a3`.

La entrada se transcribió por sus campos de metadata ya visibles en el chat; su archivo canónico no se presenta como copia byte a byte del pegado original. No se reconstruyeron campos del resultado copiándolos de la referencia. El destino se atribuye al operador: esto no crea una sesión autenticada del agente ni acredita identidad/frescura fuera de esa evidencia.

Autorización consumida: **1 ejecución reportada por el operador, 0 por el agente, 0 reintentos y 0 consultas adicionales**. No se hereda permiso para otra lectura, DCL o despliegue.

## Por qué el comparador inicial quedó en unresolved

[Comparación inicial intacta](vr1-comparison.json): columnas, tipos, typmods, propietario, security_invoker y dependencias coinciden en las tres vistas, pero las huellas de definición difieren respecto del deparse local PG18.

La referencia local omite calificadores que no necesita en la proyección exterior: `id` en vez de `o.id`/`c.id`. Para explicar esa representación se agregó el alias únicamente a las posiciones directas de columnas conocidas de las fuentes 007/024/043 y al argumento c.id de campaign_delivery_stats. No se quitaron calificadores del resultado real ni se normalizaron literales, predicados, operadores o casts para forzar igualdad.

| Vista              | Calificaciones añadidas al texto sintético           | Huella cruda / LF   | Huella léxica                   | Columnas / seguridad / dependencias     |
| ------------------ | ---------------------------------------------------- | ------------------- | ------------------------------- | --------------------------------------- |
| campaign_workspace | 25 columnas directas + c.id del argumento de función | Coincidencia exacta | Coincidencia exacta, 148 tokens | Coinciden; 27 columnas, 27 dependencias |
| opportunity_inbox  | 28 columnas directas con alias o                     | Coincidencia exacta | Coincidencia exacta, 152 tokens | Coinciden; 28 columnas, 30 dependencias |
| opportunity_tasks  | 28 columnas directas con alias o                     | Coincidencia exacta | Coincidencia exacta, 153 tokens | Coinciden; 28 columnas, 30 dependencias |

[Referencia cualificada](vr1-qualified-reference.json) es una **representación esperada derivada de SQL sintético**, no una captura nueva de catálogo. Su contexto indica el fixture de origen PG18; sus hashes se calcularon del texto con calificadores y luego se compararon con los recibidos de PG15. La referencia original, SQL VR1, scope, lexer y comparador no se modificaron.

## Evidencia local adicional

- Tres coincidencias exactas de rawHash, lfHash y el objeto lexical completo, incluido count/quotedHash. No son solo tres hashes de formato ignorando contenido.
- Tres verificaciones con CREATE OR REPLACE de la representación cualificada **solo dentro del fixture sintético**, cada una en transacción con ROLLBACK. Su deparse vuelve exactamente a la definición local original. No cambió el predicado, orden o contrato de columnas.
- Tres controles negativos de huella rechazan drift: permanecen unresolved. No se relajó el comparador para aprobar estas vistas.
- JSON/estructura/scope/contexto, enlaces, formato, hashes y conservación contrastados localmente. No se repitieron las 42 pruebas aceptadas o pilotos funcionales anteriores; estos checks de revisión no se suman a aquella batería.

La evidencia atribuye las diferencias a la representación con/sin calificadores de estas tres definiciones concretas. No afirma equivalencia SQL arbitraria, audita ACL nuevas o explica cualquier futura diferencia por versión. Los MD5 comparativos no son firmas de autenticación.

## Qué se cierra y qué sigue

PRM-T05 completo para esta instantánea; huellas de las tres vistas aclaradas. VR1 también demuestra ejecución de esta consulta en PG15.8, separadamente del diagnóstico PD-R1 anterior. No hay que recrear las vistas o repetir VR1 para resolver este punto.

REL-T03/publicación y permisos siguen parciales. La corrección de 28 relaciones **no se aplicó**; defaults y las 70 funciones conservan su tratamiento separado. SQL correctivo final, ordinal coordinado, frescura de su propio preflight, impacto de locks/concurrencia, respaldo, ventana y recuperación todavía deben prepararse antes de solicitar aplicación. No se declara que PRM1 correctivo haya sido ejecutado en PG15 o que una sesión PGlite pruebe contención real.

Siguiente paso: **PRM-T06, preparar la corrección definitiva y su protocolo de aplicación**, sin ejecutar todavía SQL remoto o desplegar. Una escritura correctiva y un postflight requerirán autorización propia; no están autorizados por este resultado.

Instantly **43 consumidas / 0 nuevas**. Gmail directo y Composio conservan su alcance anterior; no se consultaron flags, credenciales, infraestructura o proveedores. Sin envíos, verificaciones pagas, migraciones remotas, push o despliegue por el agente.
