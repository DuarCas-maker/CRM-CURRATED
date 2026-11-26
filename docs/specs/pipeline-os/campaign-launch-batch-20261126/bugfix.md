# Creación de campañas por lotes — STRICT

El usuario solicita corregir el error al crear una campaña de 100 contactos que pasaron la revisión de datos. Se conserva el flujo y la autorización de publicación de Campañas; no se activan campañas reales ni se envían correos para comprobarlo. No hay decisiones nuevas de negocio pendientes.

Diagnóstico reproducido: PostgreSQL 15 temporal, 4.004 contactos ficticios, plantilla financiera y 100 destinatarios. La operación se cancela a los 8.095 ms por statement_timeout, igual al presupuesto autenticado de producción (8 s). El contexto apunta a la comprobación correlacionada de destinatarios en crm_command_before_brand_b1. La revisión previa de datos es una operación distinta y sí termina.

Hipótesis: H1 repetición del catálogo de audiencia en comprobaciones por contacto (reproducida); H2 faltan ingresos (la revisión real muestra 100 listos; no explica este timeout); H3 fecha/remitente inválidos (tienen errores explícitos, no se cambian sus reglas).

- FR-001 / AC-001: una campaña de 100 contactos elegibles debe completar creación y programación bajo el presupuesto actual con 4.000 contactos ficticios adicionales.
- FR-002 / AC-002: conservar comprobaciones de elegibilidad, campos faltantes, MFA, marca, bloqueos, snapshots, recibos e idempotencia; un fallo revierte toda la operación.
- FR-003 / AC-003: un timeout debe comunicar una espera de base de datos de forma segura, sin filtrar errores SQL ni activar reintentos automáticos.
- FR-004 / AC-004: publicación con catálogo conciliado, respaldo reciente y reversa probada. Sin cambios de ingresos, verificaciones, límites o campañas existentes.
