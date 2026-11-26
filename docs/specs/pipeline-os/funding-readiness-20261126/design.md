# Diseño

Tres RPC aditivas: listas del funnel y disponibles con ingreso/resumen/filtro, y revisión de plantilla para hasta 100 IDs seleccionados. Se apoyan en lead_states/campaign_prepared_leads/first_contact_candidates existentes, con MFA/roles y remitente autorizado. No sobrescribir funciones previas ni tablas, ni conceder acceso nuevo a actores anónimos o service_role.

Listas únicas por contact_id, filtros antes de LIMIT/OFFSET y orden estable. Resúmenes globales separados del alcance filtrado. Los estados del funnel permanecen completos; ingreso es un atributo, no una etapa ni un criterio Bouncer.

La revisión recibe plantilla/versión/remitente/IDs/recordatorios, valida acceso a cada ID y devuelve solo los candidatos autorizados con motivos. El frontend invalida respuestas previas al cambiar configuración y muestra faltantes sin eliminarlos. La creación SQL original sigue revalidando bajo sus bloqueos.
