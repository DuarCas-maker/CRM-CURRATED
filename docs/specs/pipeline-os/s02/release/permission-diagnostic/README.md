# Diagnóstico de permisos y huellas del catálogo

**Continuación preparada (01/11/2026):** [PRM1 y VR1](../permission-remediation/README.md) delimitan la corrección de `anon`/`authenticated` en 28 relaciones y la revisión de tres vistas. Las seis dependencias adicionales quedan explicadas por sus descriptores propios. El paso siguiente es implementar y probar offline; no repetir PD-R1, instalar otro motor o ejecutar migraciones. Las constancias siguientes conservan su contexto histórico.

**Resultado actual01/11/2026:** el operador ejecutó PD-R1 en el motor real y aportó salida válida de PostgreSQL15.8/READ ONLY. [Revisión y siguientes pasos](result-review.md), [CR-001](changes/CR-001-real-readonly-validation.md). La necesidad de montar PG15 aislado para comprobar esta consulta queda sustituida por esa evidencia;32 pruebas offline se conservan como PGlite18. Permisos/vistas aún con hallazgos; no migrar ni publicar. Los párrafos de implementación siguientes conservan su contexto histórico.

01/11/2026 · SDD STRICT · **Diagnóstico implementado y probado offline; nunca ejecutado en remoto por el agente.** [SQL generado](diagnostic.sql), [contrato de implementación](implementation-design.md), [QA y límites](implementation-verification.md), [requisitos](spec.md), [diseño](design.md), [aceptación](acceptance.md), [tareas](tasks.md), [inventario recibido](observations.json).

El inventario observations y preparation-checks conservan la evidencia histórica de preparación. La implementación posterior tiene manifiesto/QA propios; no reescribe el catálogo recibido ni los100 archivos del candidato A/B/C. El próximo gate es comprobar la ejecución en PostgreSQL15 independiente: las32 pruebas nuevas pasaron con PGlite18; Docker/psql/postgres no se encuentran en PATH. No se habilitó ni instaló otro entorno.

El usuario aportó el resultado de `pipeline_os_abc_catalog` y pidió preparar el diagnóstico, sin llamadas reales o cambios remotos. La evidencia corresponde a una consulta READ ONLY atribuida por el usuario al Supabase self-hosted del CRM, `https://supabase.finlabinc.com/`. El agente no obtuvo una sesión autenticada ni ejecutó SQL remoto. Supabase Cloud/Admin Charlom y su referencia quedan expresamente fuera de este diagnóstico.

## Lo comprobado y lo que falta

| Grupo             | Evidencia recibida / contraste local                                                                                                                     | Estado                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Contexto          | PostgreSQL 15.8, `supabase_admin`, READ ONLY, superuser/BYPASSRLS y lectura de profiles; tres roles presentes.                                           | Inventario legible. No demuestra identidad del servidor, frescura o historial.                          |
| A/B/C             | Esquemas y objetos nuevos ausentes; 93 relaciones y 206 funciones existentes.                                                                            | Estado previo a A/B/C; no una migración aplicada.                                                       |
| ACL               | 28 relaciones públicas con privilegios adicionales: 22 tablas y 6 vistas; incluye `anon`/`authenticated`.                                                | Diferencia efectiva confirmada; origen e impacto por operación pendientes.                              |
| Funciones         | 70 diferencias de EXECUTE: únicamente `service_role`; ningún nuevo permiso humano o PUBLIC frente a la referencia.                                       | No equivale a aprobación de acceso de servicio a funciones internas.                                    |
| Definiciones      | 205/206 hashes de funciones difieren; convertir CRLF a LF en la referencia deja las mismas 205 diferencias.                                              | La hipótesis «solo saltos de línea» no explica los hashes recibidos. No prueba 205 cambios funcionales. |
| Constraints       | 619 ausencias en la referencia son todas tipo `n` (NOT NULL de PG18); columnas públicas conservan su metadata. Una FK de profiles tiene huella distinta. | Representación por versión separada; FK pendiente, no recrear constraints por conteo.                   |
| Policies / vistas | Ocho huellas de policies y tres de vistas públicas difieren.                                                                                             | Expresiones/representación aún sin explicar.                                                            |
| Storage           | Dos tablas más completas, dos constraints, cuatro triggers y seis índices adicionales frente al fixture mínimo.                                          | Separar componente de plataforma y migraciones de negocio. No reemplazar Storage.                       |
| Operación         | Una cuenta conectada sin marca; 381 mensajes sin procedencia de marca confirmada; outbox contiene ocho `sent`, ningún otro estado en esa instantánea.    | No reasignar ni rellenar automáticamente; no demuestra estado actual de la cola.                        |
| Historia          | No aparece `supabase_migrations.schema_migrations`. Objetos 046/047 presentes.                                                                           | No permite asegurar qué archivos se aplicaron ni reservar ordinales finales.                            |

RLS activo en tablas no resuelve por sí solo el exceso de ACL: `TRUNCATE` y `REFERENCES` no están sujetos a RLS. No se probarán estas operaciones en producción. [PostgreSQL 15](https://www.postgresql.org/docs/15/ddl-rowsecurity.html). PG18 incorporó NOT NULL al catálogo de constraints; no se interpreta la diferencia de conteos como pérdida de restricciones. [Release 18](https://www.postgresql.org/docs/18/release-18.html).

Los381 mensajes del agregado usan el fallback «sin confirmar» del catálogo previo a B2, también cuando falta la columna de procedencia. No representan381 fallos comprobados ni autorizan un backfill o cambio de marcas.

## Protocolo y presupuesto propuestos

1. Script y comparación implementados; no cliente de red, dependencias nuevas o migraciones. Usar solo [diagnostic.sql](diagnostic.sql), nunca la plantilla sin scope. Los comandos locales están en la evidencia de implementación.
2. Ensayos offline de ACL directas, PUBLIC, herencia, defaults, huellas y controles negativos:32/32 correctos. Compatibilidad de catálogos/sintaxis PG15 revisada; ejecución nativaPG15 pendiente y declarada antes de cualquier propuesta remota. No repetir pilotos aceptados de correo, adjuntos, importación o Composio.
3. Tras resolver ese gate, presentar el SQL/hash exactos para autorización específica de **una ejecución manual de un script READ ONLY combinado** en el SQL Editor del Supabase del CRM. No hay reintentos automáticos: ante error, detenerse y revisar sin otra ejecución.
4. Revisar la evidencia contra la base exacta y, si no se resuelven diferencias de renderizado, contrastar offline con PostgreSQL 15. No pedir cuerpos de funciones reales, credenciales o filas de clientes para desbloquearlo.
5. Emitir clasificación por objeto: explicado, desvío de permisos confirmado, plataforma/versionado o pendiente. Proponer corrección separada solo cuando la causa esté sustentada.

**Ahora: 0 consultas remotas. Futuro diagnóstico: 1 ejecución SQL de lectura; 0 peticiones a Instantly/Composio, 0 envíos y 0 operaciones pagas.** Una ejecución de script puede contener BEGIN/SET/SELECT/ROLLBACK; no se presenta como una única petición HTTP del panel. Si la evidencia es incompleta, no se consume otro intento ni se cierra el gate sin nuevo alcance.

La autorización previa de catálogo se usó por el operador para aportar la instantánea; no se reutiliza para nuevas consultas. Instantly43/0 nuevas, Gmail directo activo y Composio deshabilitado por alcance preservado; flags y versiones remotas actuales no se han vuelto a consultar.

## Resultado y recuperación

REL-T03 permanece **parcial, con diferencias abiertas**. Este paquete no aprueba el preflight completo, la publicación, los ordinales ni cambios de permisos. QA visual/build/contención, metadatos Coolify, rollback y bootstrap siguen en el [runbook conjunto](../runbook.md).

Al ejecutarse en el futuro, el diagnóstico terminará con ROLLBACK y no necesitará reversa de datos. Si se interrumpe el panel con transacción abierta, cerrar únicamente esa transacción mediante ROLLBACK antes de continuar; no iniciar cambios o reintentos. No modificar grants, defaults, owners, RLS, roles, historial, marcas o colas durante el diagnóstico. La preparación documental se puede descartar por selección de archivos propios, sin revertir el WIP A/B/C.

Siguiente paso: completar la comprobación offline en motorPG15 independiente, con datos ficticios y acceso a proveedores bloqueado, antes de proponer la única consulta real. No hay autorización para instalar/arrancar infraestructura, aplicar migraciones o ejecutar el SQL remoto. El diagnóstico local y sus pruebas ya están terminados; este límite de compatibilidad no se convierte en PASS por usar PGlite18.
