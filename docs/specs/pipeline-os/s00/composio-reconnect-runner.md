# S00-B: ejecutor de reconexión M1 y QA offline

Estado al 26 de octubre de 2026: implementado y probado offline; ensayo real autorizado ejecutado parcialmente. M1 revocado, M2 correcto durante corte, candidato de recuperación identificado como M2 por consulta diagnóstica autorizada: recovery_required, sin binding. **21 nuevas/81 acumuladas, H4 agotada; no ejecutar otra recuperación automática.** El resto describe la implementación y su QA inicial. [Contrato y diez AC](composio-reconnect.md), [evidencia actual](../verification.md). [S00-C](composio-m1-correction.md) propone la siguiente corrección; todavía no implementada ni autorizada para API.

## Archivos y responsabilidad

- [s00-composio-reconnect.ts](../../../../scripts/pipeline-os/s00-composio-reconnect.ts): fases, selección de M1/M2, gates, contadores, manejo de incertidumbre y binding pausado.
- [s00-composio-reconnect-files.ts](../../../../scripts/pipeline-os/s00-composio-reconnect-files.ts): journal privado, lectura de las dos fuentes anteriores y tres locks ordenados.
- [s00-composio-reconnect-cli.ts](../../../../scripts/pipeline-os/s00-composio-reconnect-cli.ts): acciones explícitas y estado offline por defecto, sin dotenv o navegación OAuth automática.
- [tests](../../../../tests/pipeline-os-s00-composio-reconnect.test.ts): 45 escenarios sintéticos, además de las regresiones S00.
- [Helpers compartidos](../../../../scripts/pipeline-os/s00-composio-common.ts): transporte bounded y query metadata, usados por runner/observer/reconnect; los consumidores anteriores conservan su allowlist.

Los cambios se limitan a scripts/tests/documentación S00; no importan Next, worker, Supabase, campañas, pagos o IA. No hay nuevas dependencias. Los CLI anteriores detectan el nuevo ledger para impedir ejecución con saldo histórico obsoleto; consultar status sigue siendo offline.

## Comandos seguros, sin API

En PowerShell desde la raíz del proyecto:

```powershell
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx --test tests/pipeline-os-s00-composio-reconnect.test.ts
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' node_modules/typescript/bin/tsc --noEmit
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx scripts/pipeline-os/s00-composio-reconnect-cli.ts
```

El último comando solo consulta el journal de reconexión si existe: sin él muestra not_started, cero nuevas y referencia histórica60. No carga env, crea carpetas, temporizadores o valida proveedores. Tampoco imprime URL/link_token, correo o IDs. No es una nueva comprobación de conexión. Las pruebas crean y limpian únicamente carpetas propias `.local/s00-reconnect-test-*`, con credenciales/fuentes simuladas, nunca los directorios reales de credenciales o journals.

La ejecución final de seis suites utilizó un preload que sustituye fetch global por REAL_NETWORK_FORBIDDEN. Solo fetch/reloj/store inyectados satisfacen los tests. Los procesos hijos del nuevo CLI también se probaron con guard de red y argumentos malformados redactados.

## Acciones implementadas para una futura prueba autorizada

| Acción    | Condición / efecto                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status    | Siempre offline, sin fuente/env o locks nuevos. Es también el default.                                                                                                                                                                                     |
| prepare   | Verifica fuente final60, config propia/perfiles/hilo; conserva20 slots después de crear un enlace normal con vigencia útil mínima3min. No revoca.                                                                                                          |
| revoke    | Exige prepared, enlace vigente, permiso y reserva. Un solo POST M1, GET de conciliación, rechazo controlado del ID viejo y M2 correcto. No repite POST reservado.                                                                                          |
| verify    | Exige confirmación humana de OAuth; hasta cuatro GET del candidate normal, perfil efectivo, histórico/relectura y M2 final; binding pausado, uso final.                                                                                                    |
| reconcile | Solo lectura explícita de revocación incierta/controles pendientes o de una creación de link incierta. Un listado paginado o ambiguo no identifica por user_id; URL perdida nunca se reconstruye de tokens enmascarados.                                   |
| recover   | Requiere confirmación separada. Hasta H4 para leer estado, crear un segundo link solo ante vencimiento/fallo inequívoco o recuperar un candidate ya ACTIVE, y verificar identidad. Una identidad ACTIVE equivocada queda pendiente de recuperación manual. |

La futura ejecución requiere `--execute`, `--authorized-total=88`, `--authorize-connection-management`, `--included-calls-confirmed` y `--gates-confirmed`. Este último refleja que el operador comprobó permisos de gestión, presencia humana, aislamiento del grant y ausencia de verifier pendiente; no consulta o modifica esos permisos. verify añade `--oauth-completed`; recover añade `--recovery-confirmed` y, si corresponde, confirmación de OAuth. **Los flags no reemplazan autorización del usuario. No se ejecutaron con credenciales reales.**

No se incluye un comando listo para revocar cuentas. La clave nueva de gestión puede diferir de la usada en S00-A, pero proyecto/config/cuentas deben coincidir; una rotación durante el ensayo se bloquea para revisión. No se extraen refresh/access tokens ni se edita s00.env automáticamente.

## Persistencia y recuperación

El archivo propuesto `.local/pipeline-os/s00-composio-reconnect.json` es privado/ignorado y usa modo0600 cuando aplica. Contiene ID de transporte, URL hospedada de corta duración, huellas, baseline, checks y contadores. El link_token no se guarda; el reporte público nunca expone URL, IDs, correos o headers. El operador debe abrir el enlace por el canal privado acordado después del corte; el CLI no inicia navegador ni solicita contraseñas.

Locks: run anterior → observación anterior → reconexión. Los registros anteriores se leen sin modificarlos. No borrar/renombrar ledger o temporales huérfanos para recuperar presupuesto. Ante error de disco no se continúa con HTTP. Una mutación IN_FLIGHT pasa a UNCERTAIN en recuperación; únicamente un GET puede conciliarla, sin repetir POST. Si un link incierto se encuentra pero la URL se perdió, no se adivina ni se crea otro en bucle.

Los proofs de identidad/histórico se invalidan cuando el candidate deja de ACTIVE y cuando cambia su ID; un segundo enlace debe pasar sus propios checks. Presupuesto independiente N≤21/R≤3/H≤4, total≤28, base60/techo propuesto88. Tras aceptar binding, M1 permanece operativamente pausado y no se inicia worker/campaña. El resultado terminal se relee sin red/escrituras. Si falta el uso final, closureComplete=false y CLI exit2; la identidad recuperada no se confunde con cierre completo de la prueba.

Una recuperación fallida queda visible y puede requerir intervención humana; no hay garantía de restauración si Google deniega el consentimiento. La compensación será reautorizar el mismo Gmail, no restaurar tokens revocados o borrar conexiones ajenas. En esta entrega no se probó el acceso real ni se afectó ninguna cuenta. T04/T05 operativos y reconexión dentro del CRM (S02) siguen pendientes.
