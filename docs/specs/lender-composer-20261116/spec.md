# Editor de correos a lenders — STRICT

Modo: implementación local. Base: a881100; rama codex/lender-composer-20261116. Producción, migraciones remotas y envíos reales no están autorizados para este incremento.

## Contexto y decisiones confirmadas

El editor usa el modal de 520 px. El límite de 20 aparece en UI, validadores y funciones SQL, no hay evidencia de que sea un límite del proveedor. La cola ya representa un mensaje por lender y el worker aplica permisos y controles de entrega. Existe biblioteca de campañas con secuencias, archivos genéricos y baja; no debe confundirse con un paquete de financiación.

17A: guardar asunto y mensaje con variables; elegir documentos en cada expediente. 18A: corregir o quitar destinatarios inválidos antes de confirmar, sin omitirlos silenciosamente. 19A: destacar variables sin dato y bloquear hasta completar el expediente o editar el mensaje. Se conserva la revisión de marca, cuenta, paquete documental y confirmación final.

## Requisitos y aceptación

| FR | Requisito | AC comprobable |
|---|---|---|
| FR-001 | Modal amplio, secciones claras y preview | AC-001: a 1280 px editor y preview comparten pantalla; a 360/768 px no hay desbordamiento horizontal; teclado y cierre protegido funcionan. |
| FR-002 | Seleccionar catálogo activo completo | AC-002: 73 o más lenders se seleccionan sin tope de 20; los que no tienen contacto válido permanecen visibles con error. |
| FR-003 | Envíos independientes y atómicos | AC-003: un destinatario inválido cancela todo; CC solo de su lender; reintento no duplica; las cuotas y permisos se conservan. |
| FR-004 | Biblioteca desde Pipeline OS | AC-004: usuarios activos consultan; administradores de campañas crean, editan y archivan con control de versión; no se guardan documentos ni datos resueltos de un cliente. |
| FR-005 | Aplicar plantillas existentes | AC-005: se puede copiar asunto y mensaje inicial de una campaña; no copiar pasos, archivos ni generar enlaces; variables incompatibles se señalan. |
| FR-006 | Preview con datos del expediente | AC-006: resolver los mismos campos en cliente y servidor, por lender; dato vacío/no reconocido bloquea; valores de clientes no introducen HTML. |
| FR-007 | Revisión fiel antes de enviar | AC-007: la revisión final viene del servidor autorizado, con firma y destinatarios; si cambia el contenido/contexto se exige revisar de nuevo; preview y biblioteca no encolan correos. |

NFR: sin dependencias nuevas; request acotado por tamaño, sin límite arbitrario de lenders; errores sin secretos ni logs de clientes; mantener RLS, MFA, controles de origen, fuentes documentales y marca. Reply/forward mantienen su comportamiento.

No objetivos: aumentar cuotas Gmail, campañas automáticas, importar datos, enviar correos en QA, publicar este incremento sin autorización específica.
