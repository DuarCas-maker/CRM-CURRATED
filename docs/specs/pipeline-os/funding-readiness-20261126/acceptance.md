# Aceptación

- AC-001: dos contactos con ingreso y dos sin él se distinguen en listas y conteos; cero nunca es un ingreso listo.
- AC-002: filtros antes de paginar, búsqueda sin duplicación, suma con/sin=alcance; funnel permanece igual al cambiar filtro.
- AC-003: lista mixta para plantilla financiera identifica exactamente quién carece de ingreso; plantilla normal puede admitirlos si tiene los demás campos.
- AC-004: faltas de nombre/empresa también aparecen; variables calculadas colapsan a Ingreso mensual sin repetir diez motivos.
- AC-005: anon, sin MFA, actor ajeno, remitente no autorizado e IDs no visibles no obtienen datos; versión obsoleta rechaza la revisión.
- AC-006: una selección inválida conserva todos sus IDs y no activa campañas ni genera outbox; respuesta atrasada no habilita el botón.
- AC-007: UI verificada con/sin ingreso y lista de faltantes; regresión de fórmulas, snapshots y bloqueos previa conservada.
