# Conexiones de correo simples

Nivel STRICT. Fecha: 2026-11-17, America/Bogota. Implementación local autorizada, incluidos compartidos, rutas, pantalla, worker y SQL local. Publicación y operaciones reales pendientes. Sustituye para esta entrega la aprobación manual de cada etapa de Connect; conserva sus validaciones de identidad y acceso.

## Resultado esperado

Conexiones ofrece Gmail, Composio, Instantly y TextTorrent. El superadmin con MFA escribe el correo, pulsa Conectar y completa el consentimiento del proveedor. El CRM prepara automáticamente la cuenta, los permisos del asesor, la asociación y la sincronización. No hay pasos normales para registrar candidatos, confirmar marcas, conceder cuatro consultas o elegir transporte.

Gmail directo es principal; Composio sigue disponible y puede ser respaldo automático de envíos bajo las condiciones de AC-008. Se conectan por separado cuando sea necesario: autorizar Google directamente no autoriza también a Composio. La pantalla no promete respaldo hasta comprobar ambas conexiones.

## Roles y alcance

- Superadmin activo con MFA: conecta, asigna responsable, reconecta y desconecta. Se conserva la decisión anterior de que este mismo actor inicia el consentimiento desde su sesión CRM.
- Asesor responsable activo y superadmins: usan el buzón. No se amplían accesos a otros asesores ni se eliminan restricciones de expedientes/áreas existentes.
- Todas las cuentas previstas pertenecen a la misma organización de Google Workspace de pago. Organización técnica y marca se resuelven en servidor. Marca fija: Curated Financial; se conservan IDs y datos históricos.
- Capacidad prevista: unas diez cuentas, objetivo de 500–700 salidas diarias por cuenta. Los límites reales del proveedor prevalecen; el objetivo no es una garantía de entrega ni una orden de incrementar límites existentes.
- Incluye lectura, entrada sincronizada, hilos, respuesta, envío y adjuntos desde el CRM; elección de remitente en campañas y conversaciones. Importación inicial de los últimos 30 días para nuevas conexiones.
- No incluye Outlook, IMAP/SMTP genérico, nuevas funciones de Instantly/TextTorrent, IA que responda sola, compra de créditos, ampliación de plan o inicio automático de campañas.

## Requisitos y aceptación

| FR | Requisito | AC |
|---|---|---|
| FR-001 | Cuatro tarjetas; Gmail y Composio presentan correo, estado, última sincronización y acciones simples. | AC-001 |
| FR-002 | Alta directa con correo esperado y consentimiento Google, preparada automáticamente y reanudable. | AC-002 |
| FR-003 | Alta Composio equivalente; reutilizar conexión recuperada válida sin nuevo consentimiento innecesario. | AC-003 |
| FR-004 | Marca/organización invisibles en alta; asignación de asesor automática por coincidencia única o selección explícita. | AC-004 |
| FR-005 | Solo asesor asignado activo y superadmins usan el buzón; cada operación valida permisos en servidor/DB. | AC-005 |
| FR-006 | Sincronizar 30 días inicialmente y novedades después; conservar hilos, respuestas, adjuntos e histórico existente sin duplicados. | AC-006 |
| FR-007 | Cuenta lista para uso manual y campañas iniciadas por el usuario; conectar/reconectar no arranca mensajes pendientes. | AC-007 |
| FR-008 | Respaldo Composio de un envío solo tras prueba durable de no emisión directa, con exclusión mutua. | AC-008 |
| FR-009 | Composio usa exclusivamente cupo gratuito incluido confirmado; falta de cupo/evidencia no deriva a pago. | AC-009 |
| FR-010 | Errores legibles y estados derivados de salud real de envío/sincronización y del respaldo, con recuperación segura. | AC-010 |
| FR-011 | Compatibilidad y recuperación: mantener cuentas, permisos legítimos, campañas y contenidos existentes. | AC-011 |

## Invariantes

Identidad devuelta debe coincidir exactamente con el correo solicitado y pertenecer al Workspace admitido. No inferir identidad a partir de dominio/marca ni fusionar cuentas distintas. La conexión técnica de Composio y el asesor CRM son identidades distintas.

Un cambio de permiso, responsable, marca o conexión invalida snapshots previos. Conexión revocada, asesor inactivo, contexto vencido o acceso denegado nunca se resuelven usando otro proveedor. No se conceden permisos a todos los usuarios para simplificar la UI.

Cada mensaje conserva outbox ID, Message-ID, destinatarios, contenido, adjuntos y threadId entre vías. Message-ID no es una clave de idempotencia de Gmail. Timeout, respuesta malformada, crash o fallo después de admisión no demuestran que no se envió. La búsqueda sin resultados tampoco demuestra no entrega.

Gmail y Composio comparten los límites del mismo buzón. No cambiar proveedor por cuota, bloqueo de Google, permisos denegados o pausa de campaña. Una reserva de cupo no se considera gratuita si no existe evidencia vigente del plan, uso global y todos los medidores aplicables.

Los 30 días aplican a la captura inicial de nuevas conexiones; no borrar histórico anterior de cuentas existentes ni descargarlo de nuevo por habilitar una segunda vía. Desconectar no borra mensajes ni expedientes.

## Estados visibles

Conectando, Preparando, Lista, Sincronizando, Necesita atención y Desconectada. Preparando se retoma de forma idempotente. Lista requiere capacidades comprobadas; un candidato no se pinta como listo. El respaldo se identifica como Disponible, No conectado, Necesita atención o Sin cupo incluido. Si falla sincronización aunque el respaldo pueda enviar, se muestra ese problema por separado.

## Calidad

NFR-001: pruebas con al menos dos asesores, superadmin, inactivo y anon; ningún acceso cruzado. NFR-002: ante concurrencia, crash, replay y resultado incierto, como máximo una invocación de envío admitida. No prometer exactly-once remoto. NFR-003: sin secretos/contenido de mensajes en logs y evidencia pública; tokens cifrados y solo servidor. NFR-004: verificación visual/teclado en 360, 768 y 1280 px. NFR-005: importación en lotes y límites compartidos; pruebas sintéticas de diez cuentas sin llamadas reales. NFR-006: ningún consumo pagado automático ni nuevo consentimiento si los permisos efectivos ya sirven.

## Preguntas cerradas

| Número | Decisión del usuario |
|---|---|
| 1 | A: Gmail y Google Workspace. |
| 2 | A: ocultar organización/marca y asignar Curated Financial internamente, conservando datos. |
| 3 | A: asesor asignado y superadmins. |
| 4 | A: últimos 30 días y continuación automática. |
| 5 | Aproximadamente diez cuentas, 500–700 envíos diarios por cuenta. |
| 6 | A: campañas solo al pulsar Iniciar; respuestas al pulsar Enviar. |
| 7 | A: Workspace de pago, fuera de prueba. |
| 8 | Decisión final: ambos proveedores, Gmail directo principal y Composio disponible. Sustituye la alternativa única inicial. |
| 9 | A: selector de asesor cuando no exista coincidencia única con usuario activo. |
| 10 | A: todas en una misma organización Workspace. |
| 11 | A: solo cupo gratuito incluido de Composio. |
| 12 | B: respaldo automático controlado, condicionado a no emisión comprobada y cupo gratuito. |

Sin preguntas de negocio pendientes. Disponibilidad de credenciales, configuración OAuth interna, plan/medidores Composio y ensayos reales son verificaciones técnicas pendientes; no se convierten en hechos por esta especificación.
