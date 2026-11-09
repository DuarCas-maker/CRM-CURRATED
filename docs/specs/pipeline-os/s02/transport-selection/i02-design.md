# R06-I02 — fachada, store y finalización de envío

08/11/2026 · STRICT · implementación offline autorizada por «continua» después de I01. FR02–05/07–08, T04–06. Sin nueva decisión funcional: selección por buzón, permisos/MFA, un escritor, cero fallback y conservación de Gmail directo. No APIs reales, remoto o despliegue. F2 terminó T-003 (27 pruebas reportadas); persistencia de fases/adaptadores T-004 siguen pendientes y no se copian parciales ni se inventa su mapping externo.

## Alcance concreto

Existentes: google.ts delega condicionalmente antes del token; worker/gmail.ts envuelve el ciclo de la intención ya reclamada; selection.ts admite finalización diferida y passthrough solo de errores internos saneados; .env.example añade únicamente placeholders/flag apagado. No cambiar el proxy/factory/MIME/B2 actual ni las SQL I01/C1/R05/WC/048/049.

Nuevos: runtime-context.ts (scope/puertos/fachada), runtime-service.ts (adapter RPC/configuración servidor), mail-accounts/transport-selection.ts y route transport (administración humana guardada), candidato aditivo r06-i02.local.sql y tests propios. Separar store real de la orquestación permite probar sin importar/iniciar DB, SDK, Next o HTTP reales.

Precisión surgida en la regresión C3: el contrato puro de configuración/hash se extrae a mail-transport/verification-context.ts; composio-verifier.ts lo reexporta conservando firma/algoritmo/validación. La fachada no importa el verificador ni administración C. La prueba arquitectónica original se conserva sin relajarla. La construcción directa queda en un helper único en google.ts, sin cambiar proveedor u opciones del camino compatible.

## Activación y configuración

MAIL_TRANSPORT_ROUTING_ENABLED=false por defecto conserva el recorrido directo existente y evita RPC nuevas antes de instalar el delta. En modo ruteado ninguna ausencia/error de catálogo provoca fallback. Todas las réplicas/web deben cambiar de modo bajo pausa/drenado al publicar; esta opción de compatibilidad no controla binarios viejos o procesos que sigan en modo legado.

La operación Composio de producto permanece bloqueada mediante constante de código false, independiente de env. Un contexto inyectado en pruebas permite la rama ficticia. Ni el flag de routing, una API key o un binding verified activan por sí solos Composio. La ruta humana productiva no admite preparar/confirmar transición Composio mientras esté bloqueada; no añadir botón de activación todavía.

Contexto servidor estricto separado de clave: verificationContextSchema C2 (proyecto, versión de credencial, auth config revision, cuota y procedencia revisadas). Su digest debe coincidir con la evidencia DB; proyecto/auth config/cuota coinciden con snapshot/ticket del buzón. Clave solo servidor, no s00.env ni navegador. Revalidar contexto antes del wire, sin listar proyectos o consultar al proveedor para adivinarlo. I02 acredita el contrato interno y falla cerrado; no certifica el mapping real T-004/scopes/cuota por usar fixtures.

## Ciclo de ejecución

Scope AsyncLocalStorage por intención en sendNext; no compartir finalizadores entre cuentas/callbacks. En legacy se llama al mismo cuerpo sin nuevos awaits previos. Snapshot de servicio devuelve revisión/estado/contexto de selección sin credenciales; acquire/validate ya existentes crean el permiso antes del token. Rama directa usa gmailToken; Composio usa factory/proxy existente y cero OAuth directo.

Pacing/reserve_gmail_api se ejecutan una vez con proyecto correspondiente. WC valida antes de credencial; OAuth piloto se conserva. Hook B2 y admisión R06 siguen antes del wire. Para Composio la reserva HTTP WC permanece en el proxy; no duplicarla en fachada. Para directo se reserva antes del executor.

Lecturas finalizan dentro de gmail(). SEND difiere finished: devuelve id/threadId al caller actual, que persiste mark_sent/B2 accepted; el finally del scope consulta/finaliza el permiso solo después de ese paso. Error DB tras aceptación deja uncertain; no otro POST. El helper I01 genérico conserva su comportamiento por defecto y solo el scope servidor permite diferir.

Se preservan GmailError/MailTransportError/WorkerPilotError internos saneados, sin texto libre externo. Una cuota Google acreditada necesita que el caller haya persistido defer_gmail_send/B2 known_quota antes de liberar el intento como known_rejection; no basta capturar una excepción. El índice permite nuevo intento solo después de ese cierre acreditado. Outer401/429/timeout Composio sigue incierto para SEND, sin confundirse con rechazo Google. Lecturas con rechazo HTTP contractual pueden cerrarse como known_rejection; timeout/envelope inciertos continúan bloqueados.

## SQL nuevo y permisos

Candidate I02 con marcador propio y hashes de fuente I01; no editar I01. Añade snapshot de servicio y validate_context (firma distinta para evitar sobrecarga ambigua), extiende state/index para known_rejection y finish con prueba B2, más settle_dispatch de servicio. Las tablas siguen privadas/RLS sin DML directo, humanos solo sus RPC. Snapshot/validate/settle usan marca→cuenta→route→attempt→outbox/admisión como I01. No mantener locks durante red; PG15 físico pendiente.

API humana: sesión superadmin activa/MFA de requireUser y validación DB R05, checkOrigin, UUID/query/content-type/cuerpo acotados, Zod estricto, idempotencia/CAS y no-store. Nada de service_role para aprobar. Errores fijos sin detalles DB/tuples/clave. Gate apagado y falta de SQL dan503, nunca éxito simulado.

## Verificación/rollback

Probar fachada directa y proxy con dobles, orden token/cuota/B2/WC, scope concurrencia/otro buzón, persistencia aceptada/fallo DB/cuota acreditada, ausencia/configuración obsoleta/cancelación, ruta humana y DDL revertido. Reutilizar C2/B2/WC/I01; no repetir pilotos aceptados. SQL exacto y fuentes fijados en manifiesto del incremento.

I03 conserva recepción/cursor/scheduler/push/watch/callbacks/panel/QA visual y publicación coordinada. Reversa local solo del delta propio conservando el WIP; producción futura requiere pausa/drenado y no reponer otro escritor sobre incertidumbre. No repetir049. La autorización general de producción se conserva, pero no se despliega un incremento incompleto por terminar tests offline.
