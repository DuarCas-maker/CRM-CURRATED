# PRM1 / VR1 — implementación y QA offline

01/11/2026 · SDD STRICT · PRM-T03/04 terminadas localmente. [Diseño de implementación](implementation-design.md), [uso y orden siguiente](offline-runbook.md), [manifiesto](implementation-manifest.json).

## Resultado

Corrección de permisos como [candidato local protegido](permission-correction.local.sql), sin migración numerada. Solo retira excesos de anon/authenticated en la matriz de 28 relaciones: conserva 23 SELECT, dos CRUD, tres internas sin acceso humano y derechos del servidor. No modifica políticas, definiciones, datos, defaults, EXECUTE, Storage o fuentes del producto.

[VR1](view-review.sql) devuelve contexto, columnas/opciones, dependencias y huellas de tres vistas. Lexer conservador JS/SQL probado sobre la misma definición/contexto; conserva bytes entre comillas y rechaza formatos no soportados. El comparador no acepta discrepancias léxicas por coincidir un hash crudo. [Referencia local](local-view-reference.json): solo metadata de base 001–047 ficticia, con owner de ensayo supabase_admin; no es evidencia nueva de la base real ni usa la vista B2 futura.

## Checks ejecutados

| FR / AC           | Evidencia                                                                                                                                                                                                          | Resultado                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| FR01/02 · AC01/02 | Corrección exacta y repetida; ACL fuera de los 28 intactas; preservación por hashes de todas las filas públicas ficticias y metadata; servicio y vistas intactos.                                                  | Correcto.                                        |
| FR02 · AC02       | PUBLIC, grant option, attacl, SELECT legítimo ausente, owner, RLS, security_invoker, herencia, BYPASSRLS y grantee inesperados abortan sin recortes parciales. Fallo inyectado después de revocar revierte todo.   | Correcto.                                        |
| FR02 · AC02       | anon no puede SELECT/TRUNCATE; dueño conserva CRUD de borradores/selecciones; ajeno no ve filas ni puede crearlas para otro; oportunidades/inbox/tareas visibles para dueño/admin; servicio registra uso ficticio. | Correcto; sin envío o verificación.              |
| FR03 · AC03       | Reproducidos los 70 grants EXECUTE de servicio y defaults amplios. Se preservan; controles por objeto nuevo en la misma transacción de fixture incluyen PUBLIC builtin en funciones.                               | Correcto; defaults de producción no modificados. |
| FR04 · AC04       | Doce casos JS/SQL, tres definiciones completas, variantes de espacios/case, valores entre comillas y operadores; cambio real de predicado de cada vista detectado con DDL solo ficticio.                           | Correcto.                                        |
| FR04/05 · AC04/05 | READ ONLY rechaza escritura inyectada; SQL reproducible, sin RPC/filas; parser estricto, tamaño, scope, contexto, duplicados/cuerpos extra rechazados; CLI local sin execute/URL/credenciales.                     | Correcto.                                        |
| FR06 · AC06       | 100 fuentes ABC, 47 migraciones, 49 hashes operativos, PD-R1 completo, HEAD/index y archivos ajenos conservados.                                                                                                   | Auditoría en manifiesto.                         |

Comando ejecutado con bloqueo de red local:

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-reporter=spec tests/pipeline-os-permission-remediation.test.ts
```

**42/42 pruebas nuevas, sin omitidas.** TypeScript completo: `tsc --noEmit --incremental false` correcto. Formato, enlaces, JSON, reproducibilidad SQL, patrones de secretos de alta confianza y conservación verificados; no equivalen a auditoría integral de seguridad. Motor PGlite instalado, PostgreSQL **180003**, Node 22.23.4. No se instalaron herramientas ni se arrancaron servicios.

No se repitieron las 32 pruebas PD-R1, 139 de producto o pilotos aceptados de importación/correos/adjuntos. No se suman resultados heredados a estas 42.

## Revisión propia y límites

Revisión con safe-code-review contra FR/AC y SQL generado. Durante QA se corrigieron una ambigüedad de aliases PL/pgSQL y la comparación de deparse fuera del contexto de catálogo. Se fijó además `search_path=pg_catalog, pg_temp`, con temporal al final y el mismo contexto en la referencia; una prueba adicional con pg_class temporal acredita que no redirige el diagnóstico/corrección. Se corrigió también el campo de un fixture de uso Gmail para usar la estructura real de 039. La última ejecución está íntegramente en verde; ningún test se desactivó o relajó para aprobar.

Los locks ACCESS EXCLUSIVE de vistas también pueden bloquear sus relaciones subyacentes; no se afirma que el impacto operativo se limite a 28 locks. La versión final requerirá inventariar esa huella, exclusión operativa DDL/DCL y prueba independiente de contención/ventana, además de backup/recuperación revisados. SERIALIZABLE y la sesión local no prueban concurrencia real ni garantizan ausencia de conflictos en producción. No se detuvo el worker ni se inventó un flag para ello.

VR1 **todavía no se ejecutó en PG15 o remoto**; no hereda el resultado PD-R1. La comparación real de las tres vistas continúa pendiente, igual que SQL definitivo/ordinal, promoción y autorización de aplicación. No se requiere instalar infraestructura por esta entrega. Sin cambio de esquema, no hace falta regenerar tipos de aplicación.

Rollback local: el fixture se cierra y descarta; fallos SQL revierten la transacción. El candidato no se habilita en producción eliminando su marcador por copia/pega. Tras una aplicación futura no restaurar anon/TRUNCATE mediante GRANT ALL; cualquier corrección hacia adelante conservará aprobación específica y derechos legítimos documentados.

G4/G5 de este incremento offline acreditados, con límites de motor/concurrencia explícitos; gates de publicación A/B/C y G6 pendientes. **0 consultas reales, 0 migraciones remotas, 0 push/deploy/envíos/operaciones pagas. Instantly 43 consumidas/0 nuevas; Gmail directo activo y Composio deshabilitado por alcance preservado.** No se volvieron a consultar flags o infraestructura.

Siguiente paso: presentar VR1/hash exactos para una autorización separada de una lectura manual del Supabase self-hosted del CRM. No ejecutar todavía la corrección.
