# Firma y secuencia editable — STRICT

Modo implementación y publicación dentro de la autorización persistente del módulo Campañas. Alcance: creación de campañas y biblioteca de plantillas de Pipeline OS. Stack observado Next16.3/React19, CSS existente, plantillas versionadas y snapshots de campañas en PostgreSQL.

1. Idioma confirmado: cuatro recordatorios en inglés; interfaz conserva locale.
2. Fuente de firma confirmada: Gmail de la cuenta seleccionada, con sus datos y formato configurados.

- FR-01 / AC-01: correo principal y cuatro recordatorios usan firma automática del remitente. Ninguna firma personal estática de los bloques :::signature permanece en nuevas plantillas/campañas. La consulta de firma no envía correo.
- FR-02 / AC-02: Plantillas permite editar y previsualizar cinco secciones identificadas. Guardar conserva asunto, cuerpo, cuatro intervalos2/3/3/5, formato, adjuntos y control de versión. Duplicar conserva secuencia.
- FR-03 / AC-03: creación de campaña carga la secuencia guardada, con cuatro textos ingleses por defecto cuando falta. Cambiar remitente cambia la firma de la vista previa y descarta respuestas atrasadas.
- FR-04 / AC-04: consulta de firma exige sesión activa MFA, administrador y preparación vigente de marca/cuenta. Revalidación antes de credenciales y wire, cuotas/rutas existentes y no-store; sin HTML de Gmail en el DOM principal.
- FR-05 / AC-05: adaptar versiones actuales de plantillas sin tocar snapshots/campañas/cola ya existentes. Historial anterior intacto, respaldo y reversa con comparación de versión.

No se envían pruebas reales, no se modifican credenciales, límites, programación o campañas activas. Textos comerciales existentes conservados fuera del bloque de firma. Los cuatro recordatorios futuros aún pueden editarse antes de crear una campaña.
