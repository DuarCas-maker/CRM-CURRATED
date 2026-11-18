# CR-01 verificado

- 25 pruebas pasan, 0 fallos: asignación al creador, payload de responsable ignorado, datos no seleccionados conservados, RLS del asesor anterior, MFA/roles, revisión de plantilla, replay y reversa; regresión del flujo, API multipart y lectores Pipeline/Master.
- next build --webpack exit0, incluyendo TypeScript. Sin dependencias ni .env nuevos.
- PostgreSQL15.19 nativo, CAMPAIGN_TEST_OWNER_REVISION=1: dos transacciones concurrentes, una aceptada y otra rechazada, cuatro destinatarios exactos asignados al creador; reversa antes del lanzamiento. SQL SHA657f822c…; [evidencia](native-result.json).
- Respaldo privado nuevo,58.445.823 bytes, listado y decodificado por pg_restore, sin descargar datos; [metadatos](backup.json). No constituye ensayo completo de desastre.
- SQL aplicado a Supabase productivo: cambió únicamente public.campaign_flow_launch; responsables existentes sin cambios. ACL authenticated permitida sujeta a rol/MFA; anon/service_role bloqueados. [Aplicación](sql-application.json).
- Lecturas reales previas a CR-01: API nueva anónima401/no-store, pool con sesión MFA rows[]/total0 y API Pipeline source=crm sin error. No se activaron campañas ni consumió Bouncer. No hay cambio nuevo de worker en CR-01.

Pendiente: publicar el cliente con la nota de asignación y comprobar su disponibilidad. La regla de asignación SQL ya está activa para lanzamientos nuevos; historia intacta y cuatro intervalos conservados.
