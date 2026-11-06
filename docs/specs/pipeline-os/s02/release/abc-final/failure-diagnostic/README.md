# Diagnóstico separado de 049 — AF-FDIAG-r1

**Preparado y probado offline. No ejecutarlo en producción por recibir este archivo.** [Alcance y aceptación](spec.md), [verificación](verification.md), [manifiesto](manifest.json).

El operador confirmó que ejecutó el archivo corregido completo y volvió a obtener `ABC_FINAL_CONTRACT_MISMATCH`. El error no informa qué atributo difiere. La causa específica del segundo fallo permanece abierta; los resultados offline anteriores no son evidencia de éxito en PostgreSQL 15 remoto.

El [archivo diagnóstico](diagnostic.rollback.sql) conserva el DDL, los locks y todas las guardas de la revisión sellada. Solo añade el campo `DETAIL` al error final y sustituye el cierre correcto por `ROLLBACK`. **No es solo lectura:** haría DDL, backfill y cambios de permisos transitorios. No instala 049 ni sustituye su archivo. No activa Composio, envía mensajes o usa APIs.

## Protocolo propuesto; aún no autorizado

La opción preferida sigue siendo ejecutarlo en PostgreSQL 15 aislado con datos sintéticos. Este paquete no instala ni inicia ese entorno. Para usar el CRM real se requiere aprobación específica, proyecto verificado, respaldo recuperable y exclusión operativa de escrituras concurrentes según el protocolo de 049. No se pausa ningún servicio por esta preparación.

Una eventual ejecución manual en el Supabase self-hosted del CRM se limita a **un intento del diagnóstico**, sin reintentos ni COMMIT, con hasta tres scripts:

1. Limpieza del intento fallido: `ROLLBACK;` en la sesión del editor. Puede avisar que no hay transacción activa; ese aviso no certifica el catálogo ni aplica cambios.
2. Abrir el archivo diagnóstico nuevo, comprobar su hash con el manifiesto y ejecutar el contenido completo. No seleccionar bloques ni quitar guardas. No ejecutar la migración 049 ni el postflight como sustituto.
3. Si se produce error, conservar su `DETAIL` y ejecutar `ROLLBACK;` para limpiar la transacción abortada. El cliente puede detener el lote antes de alcanzar la última sentencia. No corregir diferencias manualmente ni intentar aplicar otra vez.

**Presupuesto remoto propuesto:** máximo tres scripts manuales; un solo ensayo con DDL transitorio, cero aplicaciones confirmadas, cero lecturas adicionales de catálogo y cero peticiones a Instantly. Este presupuesto no es autorización. Un futuro preflight/postflight independiente requiere su propio alcance; no se reutilizan permisos consumidos del intento anterior.

## Qué resultado necesitamos

- Si falla en la comparación final, copiar únicamente `ERROR`, `DETAIL` y `HINT` del diagnóstico. `DETAIL` contiene protocolo, hashes, versión/collation, total de diferencias y campos/huellas de metadata, sin valores originales o cuerpos SQL. No compartir logs con datos de clientes o variables.
- `mismatchCount` suma diferencias de campos más firmas ausentes/adicionales; `fieldMismatchCount` cuenta solo los campos. `detailsTruncated` señala más de 40 detalles; el inventario tiene su propio límite de 20 firmas y su indicador de truncamiento. Un detalle truncado sigue siendo fallo.
- Si termina correctamente, el recibo debe ser `pipeline_os_abc_final_diagnostic`, protocolo `AF-FDIAG-r1`, etapa `checked_before_rollback`, `mismatchCount=0`, `commitAllowed=false`, con huellas protegidas iguales. Además debe terminar el script completo sin error. **Esto corresponde a un ensayo revertido, no a 049 instalada.**
- Si falla una guarda anterior o la huella protegida, mantener su error original y detenerse. No se silencia para obtener el reporte final.

No hay guía de aplicación productiva nueva hasta revisar la evidencia. La migración 049, el contrato, el preflight y el postflight originales conservan sus hashes; el diagnóstico tiene un hash independiente.
