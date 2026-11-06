# AF-EOL-r1 — huellas de fuente LF/CRLF

04/11/2026 · SDD STRICT · Implementación local autorizada. A/B/C y D01–D24 no cambian. Clarificación cerrada: aceptar LF/CRLF de los cuerpos sellados, conservar guardas43/Gmail directo/Composio deshabilitado, cero red/remoto. No se autoriza otro intento049.

## Problema y evidencia

El operador ejecutó049 completo en el CRM y recibió ABC_FINAL_CONTRACT_MISMATCH antes del COMMIT. La limpieza y una lectura posteriores fueron autorizadas; el resultado READ ONLY volvió a cumplir la base previa, con objetos nuevos ausentes,0 diferencias y cola0. No se afirma que se hayan inspeccionado todas las filas productivas ni que la lectura pruebe pausa del worker.

Se reproduce offline:049 LF pasa; la misma entrada convertida íntegramente aCRLF falla por117 diferencias, todas functions.sourceHash. No se conoce la serialización exacta enviada en el intento productivo; esta es una causa reproducible, no una atribución exclusiva de aquel fallo.

## Requisitos y aceptación

| FR / AC         | Resultado requerido                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EOL-FR01 / AC01 | Para117 firmas concretas, aceptar solo el MD5 de la fuente canónica y el de la transformación completa LF→CRLF observada en DB desechable. Funciones no incluidas conservan comparación exacta.                                                 |
| EOL-FR02 / AC02 | No transformar prosrc/SQL en runtime, eliminar whitespace, normalizar mayúsculas o flexibilizar deparser. Derivar la variante solo si MD5 canónico coincide, sin CR sueltos ni saltos dentro de literales/identificadores citados.              |
| EOL-FR03 / AC03 | Comparar exactamente todos los demás atributos/ACL/configuración/defaults/resultado de funciones; conservar inventario por conjunto, contexto, sending, locks, vista previa específica, fingerprint protegido, rollback y postflight READ ONLY. |
| EOL-FR04 / AC04 | Nueva versión sellada de contrato049/postflight/preflight/bindings del ejecutor. Cinco cuerpos y fuentes originales intactos. Preservar hashes de la versión fallida y evidencias históricas, sin aparentar ejecución remota de la corrección.  |
| EOL-FR05 / AC05 | Probar LF/CRLF de extremo a extremo y cruce de postflight, reproducción sin arreglo, deriva real de código/literales, fuente mixta/no admitida y metadatos/permisos. Regresión pertinente de049/preflight/ejecutor y TypeScript.                |
| EOL-FR06 / AC06 | 100 fuentes aceptadas/47 migraciones/048 y49 hashes operativos intactos;43 peticiones,0 nuevas, Gmail directo activo y Composio deshabilitado. No instalar/arrancar PostgreSQL, APIs, SQL remoto, push o despliegue.                            |

## Diseño / EOL-ADR01

Agregar postSourceVariants al contrato, indexado por firma exacta. El comparador previo conserva sourceVariants; el final usa postSourceVariants para las117 firmas y el hash único esperado para el resto. Es una whitelist de dos fuentes completas verificadas, no equivalencia por normalización. El snapshot sigue calculando MD5 crudo de prosrc y todos los demás campos se comparan sin excepción.

Las117 variantes se derivan de ejecuciones independientes de la misma049 sellada, con la comparación final fallida instrumentada solo en una copia en memoria para obtener hashes/diferencias. Antes de admitirlas, se coteja cada fuente LF con el contrato y su MD5CRLF observado. Un lexer conservador rechaza saltos dentro de comillas simples/dobles/dollar y comentarios incompletos; las117 fuentes observadas no tienen literales/identificadores citados multilínea. Así no se acepta un cambio de contenido de una cadena como mero formato. No se publican cuerpos reales en la evidencia.

La prueba completa también encontró dos rutinas que049 reemite idénticas enLF y por eso no estaban en changed.functions: public.campaign_contact_summary(uuid) y public.campaign_contacts_page(uuid,text,text,integer). CRLF cambia solo su sourceHash y activa correctamente la guarda de preservación. Se añade protectedSourceVariants con sus dos pares exactos, también derivados/examinados sin literales multilínea. Al construir la huella protegida se proyecta exclusivamente un sourceHash admitido al hash canónico de esa firma. Snapshot crudo, todos los demás atributos y hashes no admitidos permanecen íntegros; la comparación de huellas sigue siendo obligatoria. No ignorar/revocar esa guarda ni expandir el delta de producto.

La actualización reemplaza exclusivamente contrato/SHA, selección de hashes y esa proyección explícita para2 firmas en049/postflight. Los cuerposDDL y resto de comparadores/guardas quedan byte a byte recuperables respecto de la versión anterior. Se regenera preflight por su vínculo con contrato/archivo y se actualizan pins del ejecutor. No nuevo ordinal ni autodiscovery;049 no quedó instalada en el catálogo observado.

## Tareas / rollout / rollback

- EOL-T01: congelar entradas/reproducción y derivar117 pares; examinar literales. Completado como descubrimiento offline antes de modificar049.
- EOL-T02: actualizar contrato/comparadores/postflight y referencias del preflight/ejecutor, sin otros cambios de producto.
- EOL-T03: pruebas positivas/adversas/regresión, revisión y sellado de manifiestos/evidencia.
- EOL-T04: ensayo nativo/controles productivos y autorización de publicación, pendientes; esta corrección no los sustituye.

Rollback local: restaurar solo los artefactos/referencias anteriores desde los hashes conservados, mediante diff revisado; no reset/stash/revert global. No rollback remoto ni down de datos por este incremento. Las lecturas del operador están consumidas y no se reutilizan; presupuesto actual0SQL remoto/0API. Mantener publicationReady=false hasta cerrar los gates restantes.
