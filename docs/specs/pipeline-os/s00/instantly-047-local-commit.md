# R47-T04a: commit local del puente de control

El usuario autoriza preparar el commit definitivo del puente siguiendo SDD, manteniendo43 y sin push, deploy, SQL remoto o activación. Este registro acompaña ese commit local; **su identificador es el SHA del commit que contiene este documento**. No se escribe un SHA autorreferente dentro de sus propios archivos. [Candidato](instantly-047-release-candidate.md), [manifiesto de serialización Git](instantly-047-commit-manifest.json), [runbook](instantly-047-release-runbook.md), [QA](instantly-c-app-validation.md).

## Alcance y decisiones

Base `0af77b7ce3baa0d46b0dd2e7e553dd88c230a150`, rama `codex/s00-auto-receive`. Incluir los20 archivos de código/SQL/pruebas del candidato `CAPP047-20261029-r1`, documentación pública revisada y este cierre. La selección es explícita: no incorporar `.local`, `.env` reales, registros/adjuntos privados, archivos generados o trabajo S01. Conservar los cambios públicos anteriores del coordinador ya revisados. No editar funcionalidad, dependencias,046, Dockerfiles, worker o AGENTS para crear el commit.

R47-C-FR01/AC01: el payload debe coincidir con el candidato y su copia QA. R47-C-FR02/AC02: respetar `.gitattributes` y comprobar cada blob del índice contra el contenido revisado. R47-C-FR03/AC03:43/12 JSON/huellas privadas iguales y sin credenciales entre archivos seleccionados. R47-C-FR04/AC04: un commit local sobre la base, sin hooks externos, push, merge, tag, cambio de rama o acceso a servicios. R47-C-FR05/AC05: separar commit, publicación y prueba C, con evidencia y pendientes honestos.

Clarificación reutilizada: alcance del candidato y9→A ya confirmados; la solicitud nueva autoriza únicamente el registro local y mantiene las prohibiciones remotas. No requiere cambiar arquitectura o elegir otro alcance. SDD STRICT por empaquetado de auth/permisos/migración para una publicación futura; skill safe-code-review en modo revisión, sin refactor del código probado.

## Serialización Git y huellas

El candidato original fija bytes del árbol de trabajo. El repositorio declara `* text=auto eol=lf`; Git serializa texto con LF al incorporarlo al índice. Los20 archivos del payload revisado ya usan LF: sus huellas originales y Git-LF son idénticas. Se comprueba esa equivalencia sin cambiar configuración Git o reescribir el código para forzar otra terminación.

El manifiesto adicional registra para cada archivo del payload: SHA/bytes originales del candidato, SHA/bytes normalizados a LF y blob Git esperado. El SHA conjunto Git-LF se calcula sobre JSON compacto de la lista ordenada, con claves file/sha256/bytes. El commit debe contener exactamente esos bytes normalizados, comprobados contra los blobs del índice; solo CRLF→LF está permitido. Las huellas originales de preparación y la evidencia de la aplicación047 no se sustituyen ni se interpretan como digest de una imagen Linux.

El manifiesto de versión original conserva su snapshot histórico `prepared_uncommitted_not_published`; el estado vigente del registro local se obtiene de este documento y Git. Su campo pending no se usa para volver a aplicar047: el operador ya reportó Success y postflight conforme. Esta separación evita modificar la evidencia anterior o generar una referencia circular al commit.

## Tareas y aceptación de cierre

| Tarea     | Comprobación requerida                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R47-C-T01 | Revisar alcance, diff, manifest e historia SQL; fuente/privados/código iguales a la QA681.                                                                               |
| R47-C-T02 | Actualizar SDD y crear manifiesto Git-LF, sin alterar el payload o documentos ajenos.                                                                                    |
| R47-C-T03 | Preparar solo las rutas públicas acordadas; índice exacto, sin secretos/privados, blobs correspondientes, diff/formato/enlaces correctos.                                |
| R47-C-T04 | Crear un commit local, comprobar padre/árbol/contenido y ausencia de cambios pendientes del paquete; registrar SHA y evidencia de preservación en el recibo local/final. |

Evidencia vigente del payload:681/681 (25 nuevas), aceptación DB001–047, TypeScript y build Next16/Turbopack aislado, más9 escenarios de catálogo. No se repiten suites por escribir documentación y empaquetar el mismo código. La nueva verificación es de integridad, serialización Git, privacidad, selección del índice y commit. La verificación del índice debe finalizar antes de crear el commit; ante deriva o cambios ajenos, detener sin reset/stash/clean/revert.

## Estado remoto y riesgos pendientes

047 fue aplicada por el operador bajo permiso específico; postflight revisado, permisos/RLS/constraints conformes y las tres huellas046 conservadas. El agente no aplica más SQL ni prueba RPC en vivo por crear el commit. No confundir el registro del archivo047 con una solicitud de repetir su instalación.

Última versión publicada reportada:0af77b7; flag ausente según operador. Se observó imagen actual/retención2 y mecanismo Rollback, sin ejecutar recuperación. La futura publicación exige autorización del SHA definitivo/destino y comprobar el estado remoto actual, imagen recuperable y flag apagado; main con autodeploy convierte push en despliegue. No consultar el remoto ni probar health/HTTP durante este registro local.

Rollback de esta preparación: conservar el commit local y no publicarlo; no restaurar diarios o esquema para deshacer Git. Ante una futura regresión remota, aplicar el runbook autorizado con la imagen/revisión saludable y conservar046/047/evidencia. Las pruebas HTTP/RPC/PostgREST/MFA/descarga y Docker Linux siguen pendientes del bloque correspondiente. R47-T04 publicación/R47-T05 smoke y C/D/S00 permanecen abiertos.
