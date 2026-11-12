# Tareas DV

| T | FR/AC | Resultado |
| --- | --- | --- |
| T01 | 01/02 | Lectura CRM mínima y correlación local con alias/ID original; sin inferencias por ACTIVE o nombre. |
| T02 | 02/03 | Borrador privado, referencias de secretos y propuesta de política; datos faltantes y estado no publicado explícitos. |
| T03 | 04/05 | Presupuesto5 y evidencia de consumo/tarifa separados; cuota de proxy restante aún desconocida. |
| T04 | 06 | Validación offline con schemas reales y bloqueo de borrador incompleto; preservación de fuentes y49 archivos operativos. |
| T05 | 02/04 | Pendiente: lectura autorizada Auth Config, completar last_updated_at y cerrar cupo. |
| T06 | 03/04/06 | Pendiente: autorizar/publicar configuración limitada y sesión MFA; sin activar transporte Composio. |
| T07 | 01/02/04/06 | Pendiente: check real máximo4, confirmación humana y acta; corte operativo separado. |
| T06a / DV-LIMIT-UI | 07/08 | Implementado y probado offline tras autorización posterior: caller/UI humana para política y presupuesto. Evidencia en controls-verification.md. Sin publicar ni configurar en vivo. |

Actualización posterior: [metadata-result.md](metadata-result.md) acepta la única
consulta Auth Config y resuelve esa parte de T05. El cupo sigue pendiente; ver
[guía específica](proxy-quota-guide.md). Configuración limitada preparada después,
sin publicar valores ni conceder presupuesto.

T01–T04 no autorizan T05–T07. No se reimplementa I04 ni se repiten pilotos
aceptados de importación, recepción o adjuntos. Ver evidencia observada en
verification.md; los estados no se convierten en éxito por crear documentos.
