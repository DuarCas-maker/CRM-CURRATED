# AF-INV-r2 — diagnóstico de ABC_BASE_FUNCTION_INVENTORY_MISMATCH

**Continuación con lectura autorizada recibida:** [resultado y trazabilidad de collation](result-review.md).206/206 firmas, cero faltantes/adicionales; orderedArrayMatch=true se explica porque el diagnóstico ordena format del catálogo con collation C, mientras la guarda ordenaba keys JSON con collation default. Se comprobó esa diferencia de origen en una prueba local nueva, sin repetir la lectura. Las hipótesis y siguientes pasos originales debajo son historia de preparación, no otra petición de consulta. Los demás gates de049 permanecen abiertos.

01/11/2026 · SDD STRICT · corrección local de la preparación SQL; sin autorización remota. El operador informa error P0001 en la guarda de inventario de049. Esa guarda precede al DDL de A/B/C; el intento reportado no llega a aplicar los cuerpos. No ejecutar otra vez049, quitar la guarda, repetir048 o emitir COMMIT suelto. No se ha comprobado el estado de la sesión del editor ni un catálogo actual por conexión del agente.

## Síntoma, hipótesis y causa comprobable

H1: diferencia en el orden de las mismas firmas por collation; H2: cambio real del conjunto; H3: representación de tipos/firmas distinta. La guarda compara una lista .sort() de JavaScript contra jsonb_agg(... ORDER BY ...) de PostgreSQL. El orden JavaScript por código y el del idioma de la DB no son el mismo contrato. Con el mismo conjunto206, Intl.Collator(en-US) cambia41 posiciones; la igualdad de arrays falla aunque no falte ni sobre una función. El mismo patrón estaba en la validación final y en postflight.

El catálogo anterior aportado por el operador registraba206 funciones con0 adicionales/0 ausentes frente a su referencia. Es evidencia histórica, no inventario actual. Se confirma **el defecto de comparación sensible al orden**; no se confirma la collation actual ni se descarta H2/H3 en esta DB sin nueva evidencia. La simulación de idioma no se presenta como ejecución en PostgreSQL15 ni como detección remota de locale.

## Corrección mínima y alcance

AF-INV-FR01/AC01: comparar objetos JSONB firma→true, no arrays ordenados. La igualdad exige las mismas firmas exactas y rechaza faltantes/adicionales; no normaliza texto, tipos, firmas o fuentes. AF-INV-FR02/AC02: cubrir orden distinto, faltante y extra; conservar guardas de actor, contratos, permisos y preservación. AF-INV-FR03/AC03: probar SQL exacto solo offline y mantener payload/contadores/remoto intactos.

Se sustituyen únicamente tres expresiones de inventario: preflight, validación final y postflight. El contrato y los cuerpos de A/B/C no cambian. Los originales fallidos se conservan localmente por hash; el manifiesto de revisión registra hashes anteriores/nuevos. El SQL049 preparado no se considera una migración aplicada por un error antes del DDL. Esta revisión no autoriza replay o aplicación remota.

## Siguiente comprobación propuesta

Una lectura de diagnóstico mínima, con autorización propia, puede comparar el conjunto actual contra el esperado sin ordenar arrays: conteos, faltantes/adicionales y collation/contexto. Solo metadata, sin fuentes, RPC o filas de clientes. No se ejecuta hoy. Si aparecen diferencias reales o firmas no canónicas, no retirarlas ni asumir que son extensiones inocuas: revisar causa. Los demás gates de publicación siguen abiertos.
