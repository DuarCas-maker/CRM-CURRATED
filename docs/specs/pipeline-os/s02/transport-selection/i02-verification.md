# R06-I02 — verificación offline

08/11/2026 · SDD STRICT · autorización «continua». [Diseño](i02-design.md), [manifiesto](i02-implementation.json), [integración y límites](i02-runbook.md).

## Resultado

**214 casos/grupos correctos de215 enumerados, cero fallos y una prueba nativa omitida por defecto.** 34 nuevos I02 y180 de regresión seleccionada (incluye I01/CW/WC/B2/C1/C2/C3/transporte/uso Gmail). Node22.23.4, red real bloqueada y dependencias ficticias. Wrapper sin flag experimental también pasa; no sumar esa repetición ni el ensayo arquitectónico aislado a la cobertura.

TypeScript `--noEmit --incremental false`, formato, enlaces, diff-check y preservación correctos. SQL nuevo instalado y revertido en memoria; no PostgreSQL nativo, proveedor real, remoto, envío, instalación, push o despliegue. Instantly43/0 nuevas.

## Requisitos y evidencia

| T/FR-AC        | Resultado local                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T04 / 02,05    | google.ts integra selección antes del token solo en modo ruteado. Comp usa tuple/contexto/proyecto persistidos, cero OAuth directo; directo conserva token/SDK actuales y una reserva de cuota. Flag ausente/false conserva compatibilidad; flag malformado falla, no elige legacy silenciosamente. No fallback de un error ruteado. |
| T04 / 02,05    | Store RPC y contexto servidor estrictos; digest C2/proyecto/auth config/cuota deben coincidir. Contexto o clave cambian durante hook/espera: no proxy. WC valida antes de credencial, reserva directa antes del wire y Composio una sola vez en el proxy. Tests de cero OAuth y de reservas.                                         |
| T05 / 03–05,08 | Ruta GET/POST humana con MFA/admin activo, sesión viva DB R05, checkOrigin, UUID/query/JSON/tamaño/Zod, no-store y CAS/idempotencia. No usa cliente de servicio para aprobar. Composio productivo bloqueado incluso con routing=true. Missing SQL503 y errores sin detalles privados.                                                |
| T05–06 / 04,05 | Scope por cuenta/outbox, sin segundo SEND ni cruce entre scopes paralelos. El sender real persiste mark_sent antes de settle_dispatch; no cierra por outer200. Fallo DB posterior deja uncertain, falla observable y un único POST. Tests con sender/fachada reales y DB/HTTP falsos, más ciclo de B2/SQL en memoria.                |
| T06 / 04,05    | Gmail429 conserva su clase/razón y solo libera intento después de defer_gmail_send/B2 known_quota persistidos. Antes de esa evidencia SQL rechaza known_rejection. Índice admite un intento posterior solo tras cierre acreditado; timeout/outer401/429 Composio no se convierten en cuota Google ni disparan fallback.              |
| T06 / 07–08    | Código de C2 reexporta el contrato puro extraído; comparación de AST de cuatro símbolos demuestra mismas validaciones/hash. La prueba arquitectónica C3 original vuelve a pasar **sin editarla** y no hay acceso a administración/verificador desde el grafo de transporte.                                                          |

## Delta y revisión

Diez archivos nuevos: cinco fuentes de servidor/API/contrato neutro, candidato SQL aditivo, tres tests y una fixture. Cinco existentes cambian explícitamente: .env.example, google.ts, worker/gmail.ts, selection.ts y composio-verifier.ts. Los restantes archivos previos conservan sus hashes; manifests y documentación registran la revisión nueva sin reescribir los contratos SQL históricos.

La comparación de AST reconstruye la fuente WC anterior fijada por hash y confirma que el cuerpo comercial del worker se conserva al retirar el scope nuevo. El diff grande de worker/gmail.ts es principalmente la indentación del callback; no se cambiaron MIME, consultas, mark_sent ni tratamiento comercial de errores. La extensión opcional del helper I01 mantiene su comportamiento original para callers sin hooks nuevos; sus37 pruebas continúan pasando.

Hallazgos de verificación: las primeras respuestas falsas de thread tenían un ID distinto al solicitado y el proxy las rechazó correctamente; se corrigió la fixture. El test de importación C3 detectó un acoplamiento real al verificador C2; se extrajo solo schema/hash a un módulo neutro, conservando algoritmos/exports. No se relajaron tests, ACL, TTL, nonce o guardas para aprobar la suite.

SQL I02: tres nuevas RPC de servicio, una sustitución de finish protegida por MD5 de fuente I01, extensión acotada de estado/índice y trigger que impide reclamar otro envío mientras el intento anterior siga reservado/admitido/incierto/aceptado. ACL/RLS de tablas privadas permanecen. Reversa transaccional restaura la fuente/índice/constraint I01 y elimina trigger/RPC nuevos. El SQL es candidato de ensayo, no una migración remota numerada.

## Qué no está acreditado

PGlite no prueba contención física PostgreSQL15, GoTrue real, red/proveedor, cuota/scopes reales, configuración del proyecto, build Linux o QA visual. F2 reportó T-003 terminado27/27; su persistencia de fases/adaptadores T-004 siguen pendientes. No se copió ni ejecutó su worktree o sus privados.

El código productivo mantiene `composioProductOperationEnabled=false` y routing=false por defecto. Una clave/env/binding verified no activa Composio. El contexto con Composio habilitado de los tests es inyectado y ficticio. No se certifica el mapping real del proveedor por normalizar DTO internos.

Modo legacy y binarios anteriores no respetan el nuevo registro por cuenta: la transición de web/worker debe ser coordinada bajo pausa/drenado antes de habilitar routing. Las lecturas inciertas siguen sin auto-liberación; los resultados de escritura se concilian sin replay. I03 debe integrar recepción/cursor/scheduler/push/watch/callbacks/panel y el protocolo operativo antes de lanzar. La autorización productiva general recibida se conserva.

T04–06 terminadas para integración/ensayo offline y rutas guardadas; no para activación u operación real. Siguiente: I03 y conciliación de entregas F2 terminadas, luego SQL final/QA/corte/piloto con identidad y presupuesto propios, sin repetir049.
