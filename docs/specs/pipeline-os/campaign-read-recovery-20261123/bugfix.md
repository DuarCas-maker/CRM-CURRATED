# Carga de Campañas y resultados — STRICT

Solicitud: resolver el error real de carga de campañas en producción y corregir su causa. Se conserva la autorización de publicación del módulo y sus correcciones; no se activan campañas ni se llaman proveedores. No hay ambigüedad de comportamiento: mismos datos, filtros y permisos, con lectura completa y dentro del presupuesto existente.

Reproducción desde sesión CRM real: GET /api/campaigns/control?mode=overview&page=1000000 devuelve el mismo error genérico de la pantalla tras aproximadamente el límite SQL. Preparar leads responde correctamente. Catálogo productivo: authenticated y authenticator limitan consultas a 8 segundos. pg_stat_statements: 2.298 lecturas previas de campaign_control_read, media 4.740,6 ms y máximo 7.827,8 ms. PostgREST registra cancelaciones 57014 por statement timeout. Volumen observado: 4.030 leads, 16 grupos y 869 inscripciones.

La lectura actual invoca facts por grupo para el agregado global, otra vez para las métricas y otra vez por remitente para sus pendientes. También recalcula el mismo cupo por cada campaña que comparte cuenta. Es trabajo repetido dentro de una única consulta; no faltan leads ni resultados de Bouncer.

- FR-001: materializar hechos de las campañas visibles una sola vez en overview, reutilizándolos para métricas globales, de grupo y de remitente.
- FR-002: consultar el cupo una sola vez por cuenta visible en esa solicitud; no mantener caché entre usuarios o solicitudes.
- FR-003: conservar resultados, contrato JSON, filtros, paginación, MFA, privacidad de cuentas y deduplicación por contacto.
- FR-004: probar comparación exacta anterior/candidato, roles y tamaño comparable, publicar con respaldo y comprobar HTTP/pantalla reales.

No objetivos: aumentar timeouts, omitir campañas, aproximar cifras, cambiar estados o límites, enviar/verificar correos o modificar datos de clientes.
