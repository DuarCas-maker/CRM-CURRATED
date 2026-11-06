# AF-FDIAG-r1 — detalle del segundo fallo de 049

04/11/2026 · SDD STRICT · Preparación y pruebas locales; ninguna ejecución remota autorizada por este documento.

## Contexto y alcance confirmado

El operador volvió a recibir `ABC_FINAL_CONTRACT_MISMATCH` y confirmó A: abrió la revisión corregida y ejecutó el archivo completo en el Supabase self-hosted del CRM. Es evidencia aportada en el chat; no se verificó el texto enviado ni el estado remoto posterior. La revisión local sigue sellada: 049 `19548594…`, contrato `6fc8d3de…`.

La corrección LF/CRLF pasa en PGlite 18, pero falta la reproducción nativa en PostgreSQL 15. No se conoce el objeto/campo del segundo fallo. No se atribuye a otra causa sin evidencia.

Hipótesis: H1, diferencias de representación final entre motores; H2, metadata/ACL/defaults del entorno no reproducidos por el fixture; H3, transformación del texto enviado distinta de LF/CRLF completos. El error genérico no distingue estas hipótesis. Repetir el preflight previo al DDL tampoco revela por sí solo el estado transitorio que falló.

## Requisitos y aceptación

| FR / AC        | Resultado exigido                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FD-FR01 / AC01 | Derivar determinísticamente un archivo de diagnóstico de la revisión sellada. Rechazar entradas de otra revisión. No modificar 049, contrato, postflight, preflight, bindings ni producto.                                                                |
| FD-FR02 / AC02 | Conservar íntegros contexto, frescura, ACL, inventario, sending, locks, comparación final, huella protegida y excepción. Añadir detalle exclusivamente a `ABC_FINAL_CONTRACT_MISMATCH`; no aceptar diferencias nuevas.                                    |
| FD-FR03 / AC03 | Reportar grupo, identificador y campo, con huellas de los valores de metadata, sin cuerpos SQL, valores originales, filas, correos, tokens o credenciales. Limitar detalles a 40 y listas de inventario a 20; mantener totales y truncamiento explícitos. |
| FD-FR04 / AC04 | Sustituir únicamente el cierre por recibo diagnóstico y `ROLLBACK`. No ofrecer un camino de COMMIT del diagnóstico. Ante error, conservar la excepción que deja abortada la transacción y documentar limpieza si el cliente no alcanza el ROLLBACK final. |
| FD-FR05 / AC05 | Probar generación y rechazo de entradas alteradas, LF/CRLF, diferencias reales de código/permisos/columnas/vistas/inventario, límite de reporte y preservación de catálogo/filas tras rollback. Solo datos sintéticos y red bloqueada.                    |
| FD-FR06 / AC06 | Mantener las 43 peticiones, Gmail directo activo y Composio deshabilitado; cero APIs, SQL remoto, instalaciones, despliegue, envíos o lectura de env reales.                                                                                              |

## Diseño / FD-ADR01

El generador mantiene byte a byte el prefijo de 049 hasta el último bloque `af_check`. En ese bloque solo amplía la declaración local y la excepción final con un recorrido de las diferencias ya rechazadas. Se usan los mismos pares de fuente final aprobados; los demás atributos se comparan exactamente. El inventario sigue comparándose por conjunto.

El resultado correcto del diagnóstico se rotula `checked_before_rollback`, nunca instalación exitosa. El archivo completo acaba en `ROLLBACK`; no reemplaza la migración ni se integra al instalador. Las guardas anteriores y la huella protegida siguen lanzando sus errores originales, sin captura que los silencie.

**No es una lectura de catálogo:** ejecutaría DDL/backfill/DCL transitorio y tomaría locks. La preparación local no autoriza ejecutarlo en producción. En caso de una futura autorización hacen falta el respaldo y el control operativo de web/worker del protocolo de 049. Un fallo puede hacer que el editor no ejecute la última sentencia: el operador debe entonces limpiar la transacción con `ROLLBACK;`, sin reintentar el archivo.

No se usa el rollback como sustituto de un ensayo aislado ni se afirma que revierta efectos externos de funciones no revisadas. El archivo deriva del DDL ya revisado y conserva sus límites.

## Tareas y entrega

- FD-T01: registrar confirmación, hipótesis y alcance; congelar entradas.
- FD-T02: implementar generador, reporte limitado y archivo separado con rollback.
- FD-T03: pruebas offline y verificación de preservación; sellar hashes.
- FD-T04: reproducción nativa/decisión de ejecución, pendientes. Ninguna llamada remota por esta entrega.

Rollout local: usar únicamente el archivo separado identificado en el manifiesto. Rollback local: retirar los archivos nuevos de este incremento mediante revisión dirigida; no restaurar snapshots ajenos ni modificar 049. No hay rollback remoto ejecutado ni nueva autorización SQL.
