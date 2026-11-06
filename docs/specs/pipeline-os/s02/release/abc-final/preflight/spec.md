# AF-PRE-r1 — comparador previo y diagnóstico completo

02/11/2026 · SDD STRICT · Implementación offline autorizada. Continúa AF-P01/P02 de la revisión de precondiciones. Clarificación cerrada: se reutilizan D01–D24, VR1 y el inventario aceptado; no hay nueva decisión funcional. No se pregunta de nuevo por pruebas aceptadas.

| FR / AC         | Resultado requerido                                                                                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRE-FR01 / AC01 | En las dos comparaciones previas de 049, aceptar exclusivamente las dos huellas crudas ya aceptadas de public.campaign_workspace. Comparar todos sus demás campos exactamente; ninguna excepción en modo final ni para otra vista.                                                                                |
| PRE-FR02 / AC02 | Un script READ ONLY, una instantánea REPEATABLE READ, search_path pg_catalog,pg_temp y timeouts 15s/2s. Comprobar contexto, roles/membresías/public, ACL048, inventario, todos los objetos de contract.pre y ausencia de objetos nuevos. Diferencias por grupo/objeto/campo sin fuentes ni registros de clientes. |
| PRE-FR03 / AC03 | Contrastar atributos/argumentos/configuración/defaults/EXECUTE de funciones, 221 columnas y ACL directas, seis policies bajo el mismo contexto. No considerar equivalentes otras diferencias de deparser sin evidencia. Detectar también ACL PUBLIC de columna inesperada.                                        |
| PRE-FR04 / AC04 | Consultar solo agregados fijos de outbox/campañas para sending, queued, uncertain y legado. sending bloquea; queued/uncertain/campañas activas requieren revisión operativa, sin mutarlos. No inferir que el worker está parado.                                                                                  |
| PRE-FR05 / AC05 | Artefacto reproducible y vinculado por SHA256 a contrato y 049. Pruebas positivas y adversas, reporte acotado y preservación de metadata/filas/configuración. Fallar cerrado ante contexto incompatible o consulta incompleta.                                                                                    |
| PRE-FR06 / AC06 | Mantener fuentes A/B/C, contrato final, postflight,048, app/worker y dependencias intactos. Instantly43/0 nuevas, Gmail directo activo y Composio deshabilitado por alcance conservado. Cero llamadas/remoto/servicios/publicación.                                                                               |

No objetivos: aplicar049, repetir048/VR1/inventario dedicado, corregir policies o vistas por el resultado, certificar PG15 nativo/concurrencia/build/backup/cutover, ni activar proveedores. El diagnóstico completo cubre precondiciones SQL; no todos los controles de publicación.

## Diseño y decisión PRE-ADR01

Whitelist literal de dos hashes, limitada por grupo=relations, clave exacta, modo=pre y resto de JSON idéntico. No modificar contract.json: mantiene la referencia sintética exacta y los contratos finales. Una utilidad pública genera el preflight a partir del contrato y del snapshot SQL ya incluido en 049; verifica ese vínculo y el comparador corregido, sin regenerar los cinco cuerpos. No depende de adjuntos privados ni de una base remota.

El diagnóstico usa DO solo para variables/transacción y set_config local del recibo, sin DDL/DML ni RPC de negocio. Expresiones crudas se comparan dentro de pg_catalog,pg_temp. El reporte contiene checks por contexto, ACL048, objetos/campos, inventario y ACL de columna; limita el detalle y conserva el conteo total. Un error de permisos/timeout no produce un resultado aprobatorio. Captura agregados solo si las tablas/columnas esperadas están presentes; una captura omitida bloquea. READ ONLY permite ACCESS SHARE ordinario, nunca LOCK TABLE explícito o bloqueo de filas.

## Tareas y aceptación

- PRE-T01 (FR01): corregir solo dos bloques previos; probar ambas variantes y drift de hash/campos/otras vistas y modo final.
- PRE-T02 (FR02–05): generar el diagnóstico único; probar base válida, roles/ACL/columna/policy/función/objeto parcial/cola adversos y preservación.
- PRE-T03 (FR05–06): comprobar reproducibilidad, formato/TypeScript/diff, hashes originales y revisión de código. Registrar evidencia real en verification.md.

Rollback local: recuperar solo los dos bloques previos desde la huella anterior documentada, conservando los arreglos de inventario; retirar los nuevos artefactos mediante un diff revisado. No reset/stash/revert global. No reversa remota porque no se aplica nada.

## Ejecución futura — no autorizada

Presupuesto propuesto: **una ejecución manual del preflight.sql**, cero reintentos, cero peticiones de Instantly. Solo en Supabase self-hosted del CRM, tras autorización específica y comprobación de destino. No ejecutar049,048 o el postflight final como parte de esa lectura. Copiar el script completo, conservar Success y el JSON; ante error no reintentar ni relajar checks. Un resultado favorable no acredita una pausa del worker, frescura posterior, respaldo o preparación para publicar. Los gates restantes de protocol.md continúan abiertos.
