# S00: diagnóstico de 030 y propuesta de recuperación

25 de octubre de 2026. Diagnóstico, planificación y ejecución guiada dentro de S00-I-FR01/AC01, T00-02. El usuario autorizó aplicar la 030 en el ambiente actual y después indicó expresamente omitir el respaldo porque contiene mayoritariamente datos de prueba. Se mantiene el requisito de conservar información existente. El usuario informó que ejecutó la 030 en el SQL Editor y obtuvo Success. Es una ejecución reportada por el usuario; el JSON posterior confirma los objetos de 030 y coincide exactamente con el catálogo puntual del ensayo local. No hay cambios de código de aplicación ni migraciones nuevas.

## Resultado y alcance de la evidencia

El [segundo resultado aportado por el usuario](supabase-lender-guidelines-user-provided.json) confirma ausencia de la relación `lender_guideline_versions`, de las dos columnas de guidelines, de las tres funciones por sus firmas exactas y del trigger comprobado. Ya no se trata solo de una relación omitida por el filtro `relkind=r`. No permite reconstruir cuándo o por qué faltan los objetos ni asegurar que todo el esquema remoto equivale al repositorio.

Se reprodujo en PGlite mediante 001–029 y 031–045, sin instalar 030: coincide exactamente con las 81 tablas, RLS, conteos de políticas y seis marcadores que compartió el usuario. Instalar después el archivo **existente y sin modificar** [030_lender_management.sql](../../../../supabase/migrations/030_lender_management.sql) funciona en esa base y recupera los objetos. Esta reparación fue después ejecutada por el usuario y su catálogo puntual posterior quedó verificado; el agente no realizó la ejecución remota.

Problema de producto: el historial y guardado de guidelines y la importación de directorio dependen de estos objetos. Los snapshots nuevos de riesgo deben registrar versiones de guidelines. No se ha invocado el endpoint remoto ni se atribuye este problema a Composio. Las demás tareas S00 continúan con sus restricciones de envío/consumo.

## Propuesta concreta

Reutilizar únicamente 030, no reaplicar 001–045, editar migraciones históricas, crear un ledger retrospectivo o añadir otra migración paralela que duplique la misma funcionalidad. El archivo incorpora su transacción, tabla con RLS/política, columnas, funciones con controles de rol/MFA y trigger. No contiene una llamada de IA, envío, importación real ni un backfill de guidelines existentes. Asigna a lenders previos guidelines nulos y versión cero; no inventa versiones históricas.

La aplicación remota requiere autorización explícita conforme al [AGENTS global](C:/Users/Usuario/.codex/AGENTS.md): «Requerir aprobación explícita antes de: […] migraciones en entornos remotos». La autorización específica fue concedida después del diagnóstico: «preparemos el respaldo de Supabase y luego apliquemos la migración 030. Guíame paso a paso». No se solicita nuevamente esa autorización. El destino indicado por el usuario es el Studio de supabase.finlabinc.com utilizado para ambos catálogos. El usuario retiró expresamente el paso de respaldo en este ambiente de pruebas; quedan la aplicación y postvalidación de 030. Se mantienen los demás controles del plan; no se autorizaron costos adicionales, mensajes o cambios ajenos a 030.

| Paso    | Acción propuesta                                                                                                                                                            | Criterio verificable                                                                                                              | Estado                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| R030-01 | Revisar objeto faltante y dependencias con catálogo, sin datos.                                                                                                             | Dos resultados recibidos y comparación reproducida localmente.                                                                    | Completado en el alcance de metadatos.                                                                       |
| R030-02 | Respaldo de esquema/datos y recuperación aislada, propuestos inicialmente.                                                                                                  | Omitido expresamente por el usuario para este ambiente; conservar datos y no ejecutar operaciones destructivas.                   | Omitido por decisión del usuario; no se hizo ni se exige para esta aplicación.                               |
| R030-03 | Verificar destino y que el SQL 030 coincide con el [manifiesto local](migrations-local.json).                                                                               | Mismo entorno del SQL Editor; hash exacto, sin objetos concurrentemente creados.                                                  | Hash local comprobado; destino/preflight final pendiente antes de ejecutar.                                  |
| R030-04 | Con la autorización existente y sin respaldo por decisión del usuario, ejecutar una sola vez el archivo 030.                                                                | Commit correcto, sin errores; registrar operación y hash sin secretos ni filas de clientes.                                       | Success reportado por el usuario y catálogo puntual posterior correcto.                                      |
| R030-05 | Repetir [consulta puntual](../../../../scripts/pipeline-os/s00-lender-guidelines-inventory.sql) e [inventario](../../../../scripts/pipeline-os/s00-database-inventory.sql). | Tabla regular/RLS/una política, dos columnas, tres funciones y trigger presentes; 82 tablas/74 políticas si el resto sigue igual. | Catálogo puntual remoto correcto según JSON del usuario; inventario global posterior no solicitado/recibido. |
| R030-06 | Comprobar funcionalidad y permisos con fixtures controladas, sin IA o mensajes.                                                                                             | Conservación de lenders, rol/MFA, replay, historial y snapshots. No basta contar objetos.                                         | Ocho comprobaciones locales correctas; smoke del entorno pendiente de su alcance/autorización.               |

## Ensayo local realizado

En base desechable, con lenders ficticios existentes antes de aplicar 030 después de 045:

1. Se conserva el lender previo, incluidos identificador, nombre, correo y notas; guidelines nulos y versión cero.
2. `anon` no puede leer el historial.
3. Un seller no puede guardar guidelines.
4. Un administrador sin AAL2 no puede guardarlos.
5. Importar el directorio ficticio y repetir la misma solicitud devuelve el mismo resultado sin duplicar la importación.
6. Guardar y repetir por clave idempotente no duplica la versión; dos cambios válidos generan dos versiones y una versión esperada antigua es rechazada.
7. El snapshot creado con versión 1 no cambia al actualizar guidelines a versión 2.
8. Un segundo intento de aplicar 030 se rechaza por objetos existentes; rollback de ese intento conserva la versión y datos previos. **030 no es idempotente: no reintentarlo a ciegas.**

Resultados sanitizados, sin IDs o datos del usuario: `.local/pipeline-os/s00-late-030-rehearsal.json` y `s00-late-030-functional-result.json`. Ninguna conexión externa o archivo `.env` utilizado. No se afirma haber ensayado con los datos reales, definiciones completas o grants del servidor actual.

## Riesgos y recuperación

La adición de columnas toma bloqueos de esquema; la ventana y carga reales no se midieron. La equivalencia de 81 nombres/conteos no certifica firmas, definiciones, constraints, owners o grants del resto del servidor. La prueba PGlite demuestra compatibilidad del SQL del repositorio, no compatibilidad absoluta del Supabase actual.

Si el archivo falla antes del commit, no repetirlo: resolver el error y revertir la transacción abierta si corresponde al ejecutor. Si una comprobación falla después del commit, pausar el uso de las funciones afectadas y evaluar una corrección aditiva específica, sin asumir que existe respaldo; no borrar automáticamente tabla/columnas o datos de historial. Una reversa destructiva requiere otro análisis y autorización. Los snapshots previos no se rellenan retrospectivamente.

S00 sigue abierto por aplicación/postvalidación de 030 y pruebas operativas de proveedores. El usuario reportó Success y compartió el catálogo posterior correcto, coincidente con el local. La instalación de los objetos comprobados de 030 queda validada; no volver a aplicar 030. La funcionalidad real y el catálogo global posterior no se deducen de esa comprobación puntual. El respaldo queda fuera de esta operación por decisión explícita del usuario; no se solicita nuevamente autorización ni el JSON de diagnóstico recibido. Esta decisión no elimina los requisitos de respaldo que correspondan a futuros cambios en producción.

## Postvalidación recibida

[Resultado posterior del usuario](supabase-lender-guidelines-postmigration-user-provided.json): tabla regular public.lender_guideline_versions con cinco columnas, RLS habilitado y una política; dos columnas nuevas de lenders; tres funciones y trigger presentes. Comparación estructural exacta con targetedObjects del ensayo local correcta. Se cierra la comprobación de existencia de objetos, no la auditoría de definiciones/grants ni el smoke funcional remoto. No se asegura ausencia de pérdida de datos por este JSON: la conservación se probó localmente y el SQL no borra filas, pero no se capturó una comparación de datos reales antes/después. No se solicita al usuario compartir filas reales para ese propósito.
