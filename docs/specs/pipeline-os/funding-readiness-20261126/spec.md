# Datos de plantilla visibles — STRICT

Implementación autorizada por el usuario. Decisión A confirmada: filtros/lista de faltantes, sin excluir automáticamente contactos ni impedir otras plantillas. Conserva el flujo de publicación autorizado de Campañas; no activar campañas ni enviar pruebas.

Causa: la recuperación previa actualizó 2.052 contactos del último Excel, pero el pool tiene 4.030 leads (1.978 sin ingreso). Disponibilidad para campaña expresa validación/ausencia de bloqueo, no integridad para toda plantilla. La lista disponible usa un lector diferente sin ingreso y la creación devuelve CF_TEMPLATE_DATA sin identificar registros.

- FR-001: importe o estado explícito Con ingreso/Sin ingreso por contacto tanto en el pool disponible como en cada estado del funnel.
- FR-002: contadores con/sin ingreso para todo el pool y disponibles; filtros aplicados antes de paginar. No alterar los conteos/estados Bouncer ni sumar ambos como leads distintos.
- FR-003: comprobación de solo lectura de los contactos elegidos y los campos reales de la plantilla/secuencia. Mostrar empresas/correos y los datos faltantes; no usar valores de ejemplo para validar leads.
- FR-004: conservar selección y configuración. No excluir automáticamente: volver al lote/filtrar es una decisión del usuario. No permitir programación desde una revisión ausente, pendiente o con bloqueos.
- FR-005: MFA, permisos de lead/remitente y revalidación transaccional al programar permanecen. Cero verificación Bouncer, modificación de ingresos o envíos durante esta corrección.
