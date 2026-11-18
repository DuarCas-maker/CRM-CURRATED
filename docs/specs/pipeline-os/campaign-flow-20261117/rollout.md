# Publicación y reversa

Autorización explícita: desarrollo completo, integración y producción en crm.finlabinc.com para pruebas posteriores del usuario. No nueva solicitud por etapa.

1. Reconciliar origin/main, catálogo SQL y funciones decoradas. Conservar cambios paralelos de F1.
2. Completar pruebas locales con proveedores ficticios, PostgreSQL nativo y reversa; TS/build y revisión visual.
3. Comprobar respaldo reciente del Supabase autoalojado antes de SQL aditivo.
4. Aplicar migración versionada, publicar web y worker, seguir ambos hasta health correcto.
5. Smoke autenticado de solo lectura: pool, histórico, resultados y esquema. No activar campañas ni consumir Bouncer.

Reversa: pausar únicamente nuevas campañas de este flujo si hay incidencia; desplegar binarios anteriores compatibles. No borrar mensajes, admisiones ni evidencia de envío. Revertir funciones solo con definiciones capturadas y sin secuencias activas; conservar tablas con historial. No invocar aliases históricos que omitan controles.
