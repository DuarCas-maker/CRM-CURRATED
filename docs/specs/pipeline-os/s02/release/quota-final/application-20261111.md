# I05 / 052 — aplicación remota aceptada

11/11/2026 · SDD STRICT · CRM Qrated self-hosted.

El usuario autorizó revisar el chat «Conectar supabase» y ejecutar la migración.
Se utilizó su conexión administrativa existente a
`https://supabase.finlabinc.com/pg/query`, sin mostrar credenciales ni editar env.
La configuración privada conserva su valor original; se usó HTTPS443, ya
verificado en ese chat, en lugar del puerto8000 configurado.

## Resultado observado

| Paso | Ejecuciones | HTTP | Evidencia |
| --- | --- | --- | --- |
| Preflight052, solo lectura | 1 | 200 | `catalogOk:true`, `queueOk:true`, `mismatchCount:0`; los10 contadores de cola en cero |
| 052 completa, BEGIN→COMMIT | 1 | 200 | `targetsOk:true`, `preservationMatches:true`, `policyPublished:false` |
| Postflight052 independiente, solo lectura | 1 | 200 | `targetsOk:true`, `initialStateOk:true`, `mismatchCount:0` |

El postflight acredita que el catálogo esperado persiste tras finalizar la
petición de aplicación. No repetir052. Contrato:
`28e2e365438d1725f271e8d724d87f8f90516803d65f62d844cc5ebeac8a0921`.

SHA256 de los archivos exactos ejecutados, cotejados con el manifiesto:

- Preflight: `1130460e9e118714de000f8c14c4c1d1950951622871702516bb2760109caf41`.
- 052: `112d50cfd4f592802ae20257dd2954822fb21c562a52e7add05723a5b4f18786`.
- Postflight: `cb05664292a461ad1bd7414a212a53a811a0a7be9feafd3d5cfddbdd1b2fa1f0`.

Catálogo protegido: `e4400e17616ef50cdb9791b927c2185b`.
Datos protegidos: `52c265bae2c24080c06e9aee68519a21`.
Las comprobaciones antes/después coinciden; no se guardan datos reales en esta evidencia.

## Alcance conservado

Tres peticiones a la API SQL, cero reintentos; cero llamadas de proveedor,
envíos, verificaciones pagas, despliegues o modificaciones de variables en vivo.
Instantly permanece en43 consumidas, cero nuevas. No se repitieron048–051.
La migración mantiene las cuentas y credenciales existentes de Gmail directo;
no publica política de cuota ni activa Composio, rutas o bindingv2.

Se verificaron localmente las tres huellas selladas, el contrato y tres rechazos
de informes inválidos antes de enviar SQL. Evidencia privada saneada y marcas de
ejecución única en `.local/pipeline-os/qgr-i05/remote-052-20261111/`.
La API devolvió los resultados entre05:45:17Z y05:45:43Z del11/11/2026.

## Pendiente

`publicationReady:false` sigue siendo correcto. La migración está aceptada;
faltan commit público revisado, publicación conjunta web/worker, builds Linux,
health y smoke autorizado según el runbook. No se comprobó nuevamente el modo
efectivo del worker ni los flags de contenedores en estas tres consultas: el
preflight es una instantánea de cola, no una pausa de procesos.

Los documentos y el manifiesto de preparación anteriores conservan su estado
histórico y sus huellas. Esta constancia es posterior y no los modifica.
La reversa `rollback-disabled-unused.sql` permanece sin ejecutar y requiere
autorización propia si llegara a ser necesaria.
