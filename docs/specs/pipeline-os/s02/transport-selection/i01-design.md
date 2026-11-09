# R06-I01 — contrato concreto de implementación offline

08/11/2026, autorización humana «hazlo» tras la preparación. STRICT. Sin nuevas decisiones funcionales: mismos FR/AC, seis archivos nuevos y evidencia propia; no tocar fachada/callers/F2 ni las SQL originales. I02/I03 siguen separados.

## Estado y locks

routes inicia paused por cuenta; bootstrap humano deja explícitamente ready/gmail_oauth solo si ya estaba connected y tiene credencial. Cuenta nueva nunca se activa por insertar route. prepare_transition pasa a draining y aumenta revisión; pause también bloquea nuevas operaciones. commit_transition exige draining y cero attempts reserved/admitted/uncertain, outbox queued/sending/uncertain, campañas/inscripciones activas y admisiones B2 admitted/uncertain; no basta vencimiento. Los queued deben pausarse explícitamente antes de cambiar proveedor, para que activar una ruta no despache pendientes antiguos. cancel_transition deja paused. No reanuda colas/campañas ni modifica membresías/live/sync. Idempotencia por recibo actor/key/fingerprint y CAS después de validar sesión viva mediante el helper Auth R05.

Orden de entrada DB: helper humano R05 (configuración/sesión/perfil compartidos), marca→cuenta (igual C1/B2), perfil→cabecera C2→binding cuando se requiere, route→attempt→outbox/admisión. Servicio usa la misma marca→cuenta antes de route/attempt; nunca mantiene row locks durante HTTP. WC bloquea su trial antes de B2; R06 no bloquea trials. Cualquier futura composición que invierta ese orden requiere revisión en I02. La contención física PG15 sigue pendiente y no se atribuye a PGlite.

## Evidencia C2

Un helper verification_ready conserva ready original y solo amplía verificación para cuenta disconnected de un intento R05 completed del mismo actor/binding/email/marca/revisión; no altera status ni el JSON de contexto comercial. Se sustituyen con fuente base fijada exclusivamente check_current, approval_current, row_dto y check_begin. Confirmación humana existente reutiliza check_current; no cambiar register_candidate ni sus guardas generales. Se preservan nonce/TTL/xmin/CAS/actor/grants/configuración.

commit Composio exige binding verified y aprobación C2 todavía dentro de su TTL original. Guarda pre/post-contextos, xmin posterior de auditoría y referencias/generaciones/actor en route. Solo el cambio exacto disconnected→connected hecho por ese commit se acredita; no se modifica account_context inmutable del binding. La aprobación operativa consumida permanece después del TTL del check, mientras contexto/actor/binding/cabecera/configuración y época de identidad sigan vigentes; no se prolongan checks pendientes. approval_current/row_dto admiten esa referencia operativa para evitar un falso stale tras activar. Revocar/reemplazar/configurar o cualquier cambio de contexto invalida esta proyección. Ninguna aprobación se fabrica desde el navegador.

Precisión del ADR al inspeccionar los callers: conservar xmin como autorización operativa permanente invalidaría la ruta al cambiar live_enabled o send_retry_at. Se mantiene xmin original en el check C2 y en auditoría, y se añade account_epoch monótona por trigger sobre email/organization/status/marca/revisión de cuenta. La aprobación operativa compara esa época, incluso ante ABA; los cambios no identitarios no alteran la autorización. No se debilita el control xmin del intervalo de verificación.

## Attempts y cursor

acquire toma cuenta/revisión/operación/recurso y hash de capability generado en servidor. Estados reserved→admitted→finished, cancel solo antes de admitted; cualquier duda después de admitir persiste uncertain. Expiración no libera una operación; no hay takeover ni replay automático. Una escritura admite un solo attempt no cancelado por outbox. admit exige delivery_allowed y una admisión B2 actual; R06 no la crea ni reemplaza. finished de send exige outbox sent, para no borrar la incertidumbre ante un error de persistencia.

El cursor se copia explícitamente una sola vez desde mail_credentials para cuentas heredadas, sin fabricar token ni tocar histórico. checkpoint de servicio exige ticket terminado de history/profile, capability vigente, cuenta/revisión actuales y CAS de cursor; máximo una actualización por ticket. History_id decimal como texto, comparación numeric. Sin retroceso ni cambio por ruta obsoleta. No se conecta todavía syncMailbox; I03 incorporará el ciclo completo.

## Resolver servidor

Tipos públicos sin tuple/secretos. Ticket privado estricto; acquire/validate antes de preparar credencial, cuota/hook una vez y admit final antes del executor inyectado. Cada port es obligatorio; no fetch/env/SDK/store real. Error saneado y cero fallback. Si falla finalización después de ejecutar, no devolver éxito ni repetir. Las pruebas falsas no acreditan proveedor/configuración reales.

RPC nuevas públicas usan SECURITY DEFINER/search_path vacío y EXECUTE solo del rol previsto; tablas privadas RLS sin acceso directo. SQL con marcador in_memory_test y sin BEGIN/COMMIT propios: el ensayo instala/revierte con su transacción externa. No ordinal nuevo ni migración remota.
