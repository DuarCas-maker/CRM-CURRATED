# Master Pipeline · SDD STRICT

15/11/2026. Implementación local de una vista general dentro de Pipeline OS, con revisión integrable antes de cualquier publicación. Base original `5f38ec6` (1166 archivos), conciliada con la base pública `01b6d3f8c2f61ba09ef60ff07a7ef4a17b9c681b` (1209 archivos) al publicarse el checklist. Snapshot final propio bajo `.local/f2-connect-t002/master-current-01b6d3f`. El checkout del coordinador conserva su WIP y no se modifica para preparar este candidato.

## Decisiones confirmadas

1. A: datos actuales del CRM; el HTML de Downloads es referencia visual/funcional. No se copian ni importan sus registros históricos de clientes.
2. A: equivalencias de las etapas del HTML, sin reemplazar estados ni transiciones del CRM.
3. A: todos los asesores permitidos por los permisos existentes. No excluir nombres particulares del HTML.
4. A: Tareas/P1 cuentan tareas individuales abiertas, una vez por ID, atribuidas a su responsable. P1 conserva la prioridad operativa del expediente que ya calcula Pipeline OS; no se introduce otro motor de prioridades.

## Requisitos y aceptación

| FR / AC | Resultado comprobable |
| --- | --- |
| MP-FR01 / AC01 | Acceso Master Pipeline en el inicio y navegación de Pipeline OS; las vistas actuales siguen accesibles. |
| MP-FR02 / AC02 | Tabla por asesor con tareas, P1, ofertas vigentes, oferta de mayor monto sin respuesta registrada, casos activos, fondeados, correos y leads pendientes. Seleccionar asesor filtra las seis pestañas. |
| MP-FR03 / AC03 | Pestañas Tareas, Ofertas, Pipeline, Indicadores, Comunicaciones y Respuestas de leads, con búsqueda, paginación, vacíos, carga y errores. |
| MP-FR04 / AC04 | Etapas equivalentes Submitted/Stips requested/Approved/Contracts out/Funded/Declined, conservando las etapas CRM adicionales que no tengan equivalencia segura. Firma de aplicación no es firma de contrato ni desembolso. |
| MP-FR05 / AC05 | Indicadores por día y asesor, contratos y desembolsos con fechas explícitas. No usar updated_at como fecha de aplicación, oferta o contrato. |
| MP-FR06 / AC06 | Sesión activa/MFA y RLS existentes. No revelar importes, procesos, correo o expedientes fuera del área/rol autorizado; no usar service_role para ampliar lecturas. |
| MP-FR07 / AC07 | Solo lectura de registros existentes. Sin migraciones, env, proveedor, envíos, importación o cambios de transporte. Conteos completos antes de paginar; no inventar cero cuando falta cobertura. |
| MP-FR08 / AC08 | Tema claro/oscuro del módulo, teclado, encabezados de tablas, móvil360px y español/inglés. Pruebas de reglas/permisos/HTTP, tipos y QA visual con fixtures ficticios. |

## Alcance funcional

Master Pipeline reúne la operación y permite abrir el expediente o la conversación ya existentes. No replica editores de negocio. «Mayor oferta» significa mayor importe vigente, distinto de la oferta elegida por una persona. «Sin respuesta registrada» compara solo mensajes registrados de la conversación relevante; no afirma ausencia de llamada, SMS o respuesta externa.

La carga actual no desaparece por cambiar el período de actividad. El período7/30/90d se aplica a gráficas, eventos y comunicaciones; se explicita en pantalla. Búsqueda y asesor se comparten entre pestañas. Las respuestas de leads usan intención guardada, excluyen bajas/automáticos y mantienen pendiente de revisión lo incierto; no ejecutan clasificación ni conversión.

## No objetivos

No cargar el HTML en un iframe ni ejecutar sus scripts/D3/CDN. No importar sus filas, excluir personas por nombre, inferir aprobaciones financieras o convertir datos faltantes en hechos. No modificar OAuth, worker, campañas, permisos o producción con las autorizaciones del trabajo anterior de Connect.
