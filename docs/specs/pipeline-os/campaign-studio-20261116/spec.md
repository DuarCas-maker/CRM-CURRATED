# Campaign Studio — SDD STRICT

Modo implementación local. Clarificación cerrada: 1A lista, motivos y reintento manual confirmado; 2A vista previa siempre visible con ejemplos. Producción requiere autorización posterior del paquete concreto.

## Contexto y alcance

Base 69b2cfa. El importador y el compositor existentes conservan sus contratos de audiencia por lote, marca explícita, MFA, borrador y activación manual. El diagnóstico acotado encontró 73 errores técnicos `provider_http_402`; Bouncer documenta este rechazo como créditos insuficientes. Esto describe la última solicitud, no el saldo actual. No se ejecutaron verificaciones.

| ID | Requisito y aceptación |
| --- | --- |
| FR-01 / AC-01 | Desde la campaña se abre la lista del lote con búsqueda, filtros, paginación, motivo legible y acceso a revisión sin perder el formulario. Una fila por contacto, sin datos de otro lote. |
| FR-02 / AC-02 | Solo errores técnicos actuales, no suprimidos y accesibles pueden seleccionarse. Reintento explícito con cantidad, advertencia de créditos y confirmación de causa resuelta. Solicitudes inciertas permanecen bloqueadas. |
| FR-03 / AC-03 | El servidor valida rol/MFA/origen, lote, selección y estado tras bloqueo. Repetir una misma solicitud no duplica trabajos; cambiar sus datos rechaza la clave. Fallos o selección desactualizada no producen cola parcial. |
| FR-04 / AC-04 | Pipeline muestra configuración compacta, audiencia resumida, opciones avanzadas y vista previa siempre visible con asunto y cuerpo ilustrativos. Conserva marca explícita, límites, horarios, selección, versiones y activación manual. El CRM clásico conserva su presentación. |
| FR-05 / AC-05 | Diseño coherente con tokens Pipeline, adaptable a 360/768/1280, modo oscuro, teclado, carga, vacío y errores. Ningún contenido de correo ejecuta HTML arbitrario. |

No objetivos: comprar créditos, verificar o reintentar contactos reales durante las pruebas, marcar válidos manualmente, conciliar solicitudes inciertas, activar campañas, enviar mensajes, cambiar worker, infraestructura o credenciales.
