# R06-I03 — recepción y administración por cuenta

Implementación STRICT local autorizada al continuar I02. Reutiliza las decisiones de identidad, marcas, MFA, escritor único y recepción aceptadas; no cambia su lógica comercial. Gmail directo predeterminado, Composio bloqueado en producto e Instantly43. Sin proveedores, SQL remoto ni despliegue en este incremento.

## Contrato y tareas

- **T07 / FR06,08 / AC06,08:** rama de recepción seleccionada antes de leer `mail_credentials`. Un ciclo durable por cuenta/revisión/época congela el cursor vivo; cada petición se vincula al ciclo y conserva la admisión I02. Solo se confirma el nuevo cursor decimal después de paginar e ingerir todo. Error, contexto obsoleto, ingestión fallida o petición incierta no lo avanzan. Una incertidumbre conserva el bloqueo; el vencimiento no permite tomarlo automáticamente.
- **T07:** scheduler selecciona rutas actuales y recepción habilitada sin exigir credenciales directas a Composio. Composio usa polling; watch/push solo directo, con revisión del job. Jobs antiguos sin revisión se descartan en modo nuevo. Modo anterior intacto cuando el flag sigue apagado.
- **T07:** OAuth directo incorpora guardas SQL al inicio y al finalizar, antes de modificar cuenta/credenciales. Un callback antiguo no puede reconectar un transporte Composio o en transición. SQL aditivo local, con huellas de las funciones reemplazadas; no editar 049 ni B1 histórico.
- **T08 / FR03,07,09 / AC03,07,09:** panel por cuenta en Configuración; lectura humana/MFA, DTO sin tuple privada, revisión CAS, comandos explícitos sin reintento automático. Distinguir asociación, selección y recepción; no afirmar que registrar una asociación activa el transporte. Ninguna acción del panel permite activar Composio mientras su bloqueo de producto sea false.

La revisión incluye un indicador saneado de trabajo sin resolver (ciclos, admisiones, cola/campañas/jobs). El panel explica ese bloqueo y deshabilita confirmar el cambio; la guarda SQL sigue siendo la autoridad, incluso si cambia el estado después de la lectura. Este incremento no habilita `live_enabled/sync_enabled` ni permisos de entrega de nuevas cuentas: su asignación y habilitación explícita corresponden al corte/piloto revisado.

## Diseño de recepción

`mail_runtime.sync_cycles` y sus enlaces a attempts son privados, RLS sin DML directo. RPC service-only para comenzar, validar, adquirir petición, completar/abortar y planificar. Lock order: marca/cuenta mediante context, ruta, ciclo, attempts, checkpoint; no transacciones abiertas durante HTTP. Las transiciones toman cuenta/ruta y rechazan ciclos activos o inciertos. El cursor histórico no se modifica. La copia inicial directa de I01 permanece exacta y única.

El ciclo dura como máximo15min; el ejecutor limita la paginación a100 páginas y10000 IDs únicos. Alcanzar un límite aborta sin checkpoint, nunca trunca silenciosamente. Recursos y respuestas se validan; los history IDs siguen como cadenas decimales. La revisión se comprueba antes de credenciales y antes de cada petición, además de las guardas I02. El servidor no descarga ni analiza adjuntos nuevos por implementar este delta.

## Verificación, entrega y reversión

Nuevas pruebas de ACL/rollback, cuenta/revisión incorrectas, recepción deshabilitada, dos ciclos, paginación, 404 histórico, cursor grande, ingestión fallida, incertidumbre y callback tardío. Regresión I01/I02/WC/CW/B2/C2/C3 y TypeScript. UI con fixtures, sin conectar al CRM remoto. Registrar por separado lo no comprobado físicamente.

T09 (PG15 físico/concurrencia, QA visual completa y SQL final promocionable) y T10 (publicación/piloto real presupuestado) siguen pendientes hasta contar con evidencia propia. PGlite no certifica locks entre dos sesiones físicas. El SQL de este incremento exige marcador local, no tiene ordinal y se ensaya dentro de transacción externa con ROLLBACK. Reversión de código por delta revisado, conservando WIP ajeno; flag nuevo permanece false y no hay cambio remoto que revertir.
