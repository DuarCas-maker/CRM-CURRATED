# R06-I02 — continuidad

[Evidencia](i02-verification.md), [manifiesto](i02-implementation.json), [diseño](i02-design.md). Implementado y probado offline, sin activar ni publicar.

## Configuración actual y futura

- `MAIL_TRANSPORT_ROUTING_ENABLED` ausente/false conserva el recorrido directo anterior. Valor distinto de true/false falla cerrado. No se cambió ninguna variable real.
- `composioProductOperationEnabled=false` es una guarda de código independiente: no basta poner routing=true o una clave para activar Composio. La ruta humana rechaza transiciones a Composio mientras esté así.
- `COMPOSIO_MAIL_CONTEXT` es JSON del contrato C2 revisado (sin clave); versión/proyecto/auth config/cuota/procedencia deben coincidir con evidencia DB y tuple de esa cuenta. `COMPOSIO_API_KEY` solo servidor. No leer/copiar s00.env ni usar IDs históricos de ensayo como catálogo productivo.
- Snapshot/validación/store faltantes producen error; no se interpreta como permiso para seguir por Gmail directo. No habilitar routing en réplicas parcialmente migradas.

No hay un paso remoto que ejecutar por terminar I02. r06.local.sql y r06-i02.local.sql son candidatos protegidos de ensayo. El SQL final del conjunto se prepara después de I03/F2 y se prueba como versión coherente; no pegar estos archivos en producción ni repetir048/049.

## Ciclo y diagnóstico

La fachada resuelve cuenta/proveedor antes del token. Lecturas terminan tras el resultado del transporte. SEND requiere scope de la intención ya reclamada: conserva permiso hasta que el caller original haya persistido B2 accepted/mark_sent. Su finally usa settle_dispatch; si no hay resultado acreditado, conserva incertidumbre y devuelve error fijo. Ni segundo POST ni cambio de proveedor como recuperación.

Un GmailQuotaError reconocido se difiere con la política existente. Solo el resultado B2 known_quota persistido permite cerrar known_rejection y admitir un intento futuro. Errores exteriores Composio no son revocación o cuota Google. Read HTTP contractual rechazado puede cerrarse; read con timeout/envelope desconocido continúa bloqueado para conciliación explícita.

La ruta transport usa cliente humano con sesión/MFA real; servicio no aprueba. Los tests de firma usan Auth/JWT/sesiones ficticios, no acreditan la configuración viva. Los errores JSON/logs no incluyen claves, direcciones, MIME, tuple ni texto libre de proveedor/DB.

## I03 y trabajo paralelo

1. Mantener F2 en alta R05/T-004 (persistencia de fases y adaptadores reales). Su T-003 está terminado offline; no atribuirle caller HTTP/OAuth instalado. Integrar solo entregas terminadas y concordar contexto/proveniencia C2, sin editar su checkout.
2. I03 desacopla cursor vivo de credenciales, programa polling por cuenta Composio y protege watch/push/callback directo antiguos. Preservar histórico/IDs/adjuntos y no rehacer pilotos aceptados.
3. Conciliar panel de alta y selección/pausa/reanudación por cuenta, asignaciones reales y QA visual/teclado ES/EN. F3 revisa evidencia/huecos; no duplicar WC/R06.
4. Preparar SQL definitivo y pre/postflight del delta, contención PostgreSQL15 física y versión compatible web/worker. Construcción normal en el Coolify existente; no exigir otro VPS por este cambio.
5. Publicación bajo la autorización general recibida y control de autoarranque: pausar/drenar emisores viejos, workers/réplicas y trabajos en vuelo. Modo legacy/instancias antiguas pueden seguir enviando directo si no se controlan; estas bibliotecas no las detienen por sí solas.
6. Configurar/revisar identidad/marca/permisos/cuota y evidencia real antes del corte de un buzón. Ejecutar solo un piloto acotado bajo presupuesto nuevo explícito; Instantly43 no se usa ni hereda remanentes. Reanudación normal es una etapa posterior con colas/campañas/inscripciones conciliadas.

## Reversa

I02 no ha modificado el remoto. Conservar el WIP y las fuentes base; para revertir localmente excluir solo su delta, no reset/stash/clean ajenos. La fixture verifica rollback de SQL I02 dejando I01 intacto.

En operación futura, pausar/drenar antes de revertir, conservar intentos/IDs/Message-ID/checkpoints y acreditar resultado de sending/uncertain; no volver al modo legacy o a otro proveedor para evadir un intento incierto. No bajar049 ni liberar permisos por deadline, borrar diarios o reencolar un mensaje aceptado. Una cuenta nueva Composio sin credencial directa legítima permanece pausada si se solicita volver a directo.
