# Diseño — Conexiones simples

Candidato actualizado sobre `544b8352634d9b07bcb0918df5866f37420515fa`, rama `codex/simple-mail-ready-20261118`: [preflight/closure.md](preflight/closure.md). Cambio adicional autorizado: prueba de adjuntos alineada con propiedad vigente de 055, conservando restricciones tras asignar closer. No modifica permisos del producto. Base b861486 de los párrafos siguientes conservada como antecedente.

Promoción preparada sobre `b86148613648076e47fbcc51db60895de331623f`, rama `codex/simple-mail-promotion-20261118`: [preflight/release-plan.md](preflight/release-plan.md). Se reutiliza la marca productiva `CURATED_FINANCIAL` con su ID existente. Los 16 contratos SQL seleccionados coinciden; OAuth queda confirmado y el presupuesto Composio sin provisionar por falta de evidencia del medidor de proxy. La base que sigue describe el diseño original, no el HEAD de publicación.

SDD STRICT, 2026-11-17. Implementación local en `codex/simple-mail-20261117`, aislada sobre `9d28d5a257ef26c618d1884f4dc90eb7c0701530`. Checkout F2 original preservado en `50d2f91`. El release previo de recuperación `5e644e5` es antecedente, no la base actual de campañas. Evidencia de fuentes en `discovery.json`.

## Existente y brechas observadas

- Next App Router/React/TypeScript, Supabase self-hosted, worker propio, pnpm. Sin introducir dependencias para este cambio.
- `src/app/api/gmail/connect/route.ts`: OAuth con openid/email/gmail.readonly/gmail.send. Ya exige superadmin y crea estado/cookie. Actualmente recibe organización e intención de marca desde el cliente.
- `src/app/api/gmail/callback/route.ts`: compara state/cookie, intercambia code, valida scopes/offline access y email_verified/hd/audience, cifra refresh token y llama `brand_oauth_finish`. No reanuda campañas históricas. Hay que vincular correo esperado y responsable, y completar automáticamente la preparación autorizada.
- `src/lib/server/google.ts`: renueva tokens, reserva cuota y delega transporte. Un invalid_grant hoy cambia el estado global del buzón y pausa outbox: no sirve como único estado al existir dos conexiones independientes. No ocultar una revocación ni deshacer pausas existentes.
- `worker/gmail.ts`: ingesta/hilos/adjuntos, envío MIME/threadId, admission de marca, mark_sent, defer de cuota y conciliación de uncertain. Conservar esta lógica; no construir otro remitente paralelo.
- `src/lib/server/mail-transport/runtime-context.ts`: Composio de producto fijado a false. Dispatch consume un envío y registra tickets para settlement. `selection.ts` distingue cancelación antes de admisión de resultado incierto después. No soporta fallback mediante volver a llamar recursivamente al mismo dispatch.
- `src/lib/server/mail-accounts/composio-verification-setup.ts`: can_grant requiere account.ready; el candidato de un buzón disconnected no se prepara automáticamente. El puente de alta admite disconnected, pero ese hecho no concede permiso de operación.
- `connections-workspace.tsx`: tres tabs y paneles de revisiones separadas; estados de binding distintos del estado de Gmail. Añadir Gmail exige actualizar navegación de teclado y resumen, no solo otra tarjeta.

## Diseño y límites

Una fachada de onboarding para cada proveedor coordina pasos durables bajo sesión superadmin/MFA, correo esperado, asesor y Workspace fijo resueltos en servidor. La aprobación de Conectar incluye los permisos/capacidades previstos y la automatización interna; no autoriza otros asesores, otros buzones ni funciones no pedidas. Cada salto externo necesita su OAuth normal; ninguna conexión transfiere tokens o consentimiento a la otra.

Persistir progreso en un ledger privado con idempotencia, revisión de actor/contexto y resultado por etapa: identidad, asociación, comprobación, habilitación de capacidades, sincronización inicial. Nombres/ordinal SQL definitivos se coordinan después de comparar catálogo real, migraciones y candidatos SQL ya instalados. Expandir sin borrar ledgers anteriores. Auth callback debe sobrevivir recarga, pérdida de respuesta y continuación de job; nunca repetir un send como parte de onboarding.

Un registro privado por cuenta/proveedor representa salud y revisión de esa conexión; estado visible se deriva de capacidades reales. Conservar mail_accounts y binding IDs. No reutilizar `mail_accounts.organization` como operating_brand ni borrar su valor: identifica configuración OAuth. Seleccionar la única configuración Workspace admitida en servidor; validar su dominio real y marca Curated Financial activa. Si no hay correspondencia técnica válida, mostrar error de configuración sin pedir al usuario una organización arbitraria.

Asignar asesor desde profiles por coincidencia normalizada única y actor activo. Si no existe coincidencia única, requerir selección de asesor activo antes del consentimiento. Mantener autorizaciones por cuenta y las restricciones existentes de expedientes/áreas; auditar accesos preexistentes antes de conciliarlos. No extender de forma implícita permisos ajenos ni revocarlos masivamente.

## Respaldo de envíos

1. Reservar mensaje y obtener ticket directo con revisión/claim vigentes. Preservar exactamente MIME/Message-ID/threadId y destinatarios.
2. Solo un fallo explícitamente clasificado de preparación de credencial directa, antes de admisión y antes de invocar POST remoto, puede ofrecer elegibilidad al respaldo. Un catch genérico, 401/403/429 de envío, falta de permisos, cambio de marca o vencimiento no la conceden.
3. Confirmar en DB que el ticket padre terminó `cancelled_before_wire`, nunca llegó a emisión, conserva el claim, y no existe resultado incierto/sent ni otro hijo. Si no se puede persistir o leer esa prueba, no continuar.
4. RPC privado atómico propuesto de fallback: bloquear outbox, padre y revisión; repetir admission de permisos/claim/buzón y revisar conexión Composio verificada, mismos email/actor y política vigente. Crear como máximo un ticket hijo para ese outbox/claim/padre. No cambiar la ruta principal global para todos los jobs.
5. Reservar cupo gratuito Composio y Gmail conjuntamente, incluyendo medidor proxy y consumo global aplicable. Revalidar revisiones y permisos justo antes del único POST. Sin admisión durable no se invoca el proveedor.
6. Usar el mismo camino de MIME y mark_sent. El settlement de dispatch incluye padre e hijo. Crash o resultado desconocido del hijo impide un nuevo padre o nuevo hijo para el mismo mensaje hasta conciliación. No intentar otra cadena de fallback.

La implementación debe integrar la alternativa dentro del dispatch existente, no reiniciar `requestScope` ni resetear `frame.used`. La evidencia de no emisión es estructural/durable; no es un booleano que envíe el navegador ni una conclusión de buscar Message-ID sin resultados. El límite de esta primera política es intencional: tras admisión, cualquier duda se concilia, aun si parece que un guard local pudo fallar antes de fetch.

Invalid_grant directo marca salud de esa conexión, sin desactivar ciegamente la alternativa válida ni reanudar colas pausadas. Restricción/bloqueo del buzón o revocación del acceso CRM afecta ambas. Un envío por respaldo no cambia el ciclo de sincronización: mantener un único ciclo/versionado por buzón para evitar ingesta doble; mostrar atención si la vía de lectura elegida no está sana.

## Cupo incluido y costos

Verificar técnicamente plan contratado, cap duro sin cargos, medidores base/managed/proxy y uso de otros clientes/proyectos de la misma cuenta facturable. El cupo local no demuestra saldo global. Evidencia obsoleta o imposibilidad de aplicar un límite sin pago significa respaldo no disponible; nunca suponer que una cuenta Pro es gratuita por tener crédito comprado.

Persistir reservas/consumo con locks y mes de facturación; operaciones inciertas cuentan de forma conservadora hasta conciliar. Onboarding, perfil, comprobaciones, sincronización y respaldo comparten ese presupuesto. Evitar consulta de proveedor por cada refresco de tabla. El límite gratuito puede dejar Composio sin disponibilidad antes de finalizar el mes; Gmail directo continúa si está sano. No comprar ni activar plan ni prometer capacidad 500–700 a través del respaldo gratuito.

## Contratos propuestos

`POST /api/mail/connections`: iniciar `{email, provider, advisor_id?}`; provider gmail_oauth/composio. Validación estricta, Origin y JSON, sesión real/MFA y actor activo. Marca/Workspace nunca se aceptan como autoridad del cliente. Resolver existing/new/reconnect en servidor sin permitir sustituir identidad. Idempotency-Key requerido; 202 progreso o URL del proveedor. 400 inválido, 401 sesión, 403 acceso, 409 contexto o consentimiento requerido, 503 configuración/cupo no comprobado.

`GET /api/mail/connections/:id`: estado sanitized propio; sin refresh tokens, IDs privados del proveedor ni efectos remotos. El callback fija resultado de autorización y deja un job durable para preparación; la UI observa progreso sin repetir POST. Los callbacks existentes conservan compatibilidad durante rollout.

`POST /api/mail/connections/:id/reconnect` y `/disconnect`: mismo actor/origen, CAS de revisión y recibo idempotente. Desconectar inhibe nuevos tickets y ciclos y conserva histórico; no elimina consentimientos del otro proveedor ni borra datos. Suscripción push, si se usa, conserva autenticación y renovación existentes. Los nombres son propuestos, no endpoints creados.

## Integración externa y seguridad

OAuth Google: state/cookie HttpOnly/SameSite/Secure, PKCE cuando sea compatible con el cliente existente, callback y audience exactos; no registrar codes/tokens. Offline access y lectura/envío mínimos. Composio: API key solo servidor y metadatos de conexión con identidad/scopes efectivos; no basta ACTIVE ni defaults de auth config.

Workers: sin JWT humanos fabricados. La autorización inicial produce una capacidad limitada a cuenta/proveedor/revisión y caducidad para finalizar setup; worker revalida actor/permiso y no emite correos. RPC humanos solo authenticated con MFA real; RPC runtime solo service_role y capacidades internas; ledgers privados RLS/revoke/empty search_path. Read models invoker o RPC con permisos explícitos. Cookie/MFA no se exponen al worker.

Timeouts HTTP explícitos; OAuth/metadata GET con reintentos acotados cuando seguros. Nunca reintento ciego de `messages/send`. Respuestas provider se validan y errores se reducen a códigos; ningún texto/mensaje/adjunto o secreto en evidencia. Payloads contractuales y schemas se contrastarán con documentación oficial/código pinned antes de construir; no inventar fixtures como evidencia real.

## UX, compatibilidad y evolución

Una tabla de cuentas por tarjeta, acción Conectar, formulario mínimo y progreso legible. Detalle opcional indica proveedor principal y salud del respaldo; las revisiones internas se automatizan. El resumen evita doble contar una cuenta conectada a ambos proveedores. Separar hora del último éxito de sincronización de hora de registro.

Reutilizar componentes/tokens/ProtectedForm y patrón de conexión a datos existentes. Composio recuperado válido se adopta y prepara; nunca migrar las diez cuentas o reemplazar conexiones existentes por abrir la pantalla. No mover configuraciones de Instantly/TextTorrent ni gastar sus APIs. Diseño responsive y teclado se prueban con datos ficticios.

Alternativas: solo Gmail (menor costo, descarta requisito ambos); fallback ante todo error (descartado: duplicados, cuota compartida y acceso); automatización solo de botones UI (descartado: fallos/concurrencia sin persistencia). Decisión elegida en `adr-001.md`.

Riesgos: setup OAuth interna aún no verificado, cupo Composio global desconocido, esquema productivo compuesto de migraciones y deltas, y main en movimiento. Se resuelven con preflight de configuración/catálogo y comparativa de commit. Plan de despliegue en `rollout.md`; esta implementación no llama proveedores ni cambia producción.

## Contratos realizados

`onboarding/service.ts` coordina recibos idempotentes; `production.ts` adapta los motores existentes y las cuatro rutas nuevas a sesiones reales con MFA. OAuth directo conserva correo esperado, Workspace, audiencia, scopes y refresh token cifrado; añade PKCE, cookie HttpOnly por intento y admisión única del intercambio. GET consulta o redirige; la finalización ocurre por POST con control de origen. Gmail y Composio tienen estados separados, y el CRM actualiza los remitentes al terminar.

`SIMPLE_MAIL_ENABLED=false` conserva el cierre por defecto. Web y worker solo incorporan al runtime nuevo cuentas preparadas. El programador combina rutas administradas y cuentas legacy, excluye rutas administradas pausadas e incluye recepción recurrente Composio sin credenciales Gmail.

La carga inicial guarda un baseline y cursor privado. Cada ciclo procesa como máximo 100 mensajes y guarda el cursor tras ingerir la página; el último avance y el checkpoint/salud de sincronización son atómicos. Se reutiliza el checkpoint del histórico existente. Un ciclo de lectura vencido puede abandonarse para retomar; sus recibos inciertos siguen intactos y nunca liberan envíos o transiciones bloqueadas.

El SQL local corrige `mail_runtime.command_v1`: la copia post052 conservaba `mail_transport_command.request_key`, inválido en PostgreSQL nativo tras renombrarla. Se comprueba el cuerpo normalizado exacto (`c2c3178219832b68d64bb85d22e39276`), conserva su DDL original privado y cambia solo ese calificador. La reversa sin uso restaura la definición original. Los SQL históricos no cambian; un catálogo distinto detiene la aplicación para conciliarlo.

Los contadores gratuitos requieren proyecto, periodo, vencimiento y evidencia de un cap sin pago. Cada intento HTTP consume una reserva nueva, incluidos reintentos; ambos proveedores conservan la cuota compartida. No se ha cargado evidencia real ni habilitado ese cupo. Fallback conserva un padre duraderamente cancelado antes de emitir y como máximo un hijo; no reintenta resultados inciertos.
