# Aceptación

- AC-001 / FR-001/002: hechos por grupo y cupo por cuenta se calculan una vez en overview; no se invoca summary antiguo en su agregado global.
- AC-002 / FR-003: JSON anterior/candidato idéntico, incluidos remitentes, bloqueos, métricas, estados, filtros y búsquedas; lectura y detalle correctos con cero destinatarios.
- AC-003 / FR-003: superadmin, seller_admin, asesor dueño/ajeno, MFA ausente y anon mantienen permisos; helper privado no ejecutable por roles API.
- AC-004 / FR-004: ensayo local PostgreSQL 15 con al menos 4.000 leads y 16 grupos, sin proveedores; comparación anterior/candidato, rollback y atributos preservados.
- AC-005 / FR-004: respaldo previo y origen verificado, SQL transaccional con hashes esperados, HTTP de producción exitoso y tarjetas visibles con datos reales. Conservación de resultados Bouncer y ausencia de envíos del agente.
