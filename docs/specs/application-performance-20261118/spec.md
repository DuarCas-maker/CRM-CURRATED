# Rendimiento de la carga común

18/11/2026 · STANDARD · implementación local autorizada.

## Problema y alcance

La aplicación publicada tarda al entrar y en varias secciones; a veces requiere recargar. Optimizar las lecturas comunes y su coordinación en el navegador conservando datos, filtros, acciones y permisos. No modificar SQL, autenticación, proveedores ni infraestructura. Publicar requiere autorización independiente.

## Preguntas y respuestas — ronda 1

1. Entorno afectado: A, aplicación publicada de uso habitual.
2. Prioridad: A, entrada y varias secciones en general.

El código resuelve las demás reglas: conservar RLS, MFA, contratos de Workspace, límites y orden del correo, idiomas y comportamiento de acciones. No se necesita una nueva decisión de negocio para eliminar esperas y duplicados.

## Requisitos y aceptación

| FR | Requisito | AC verificable |
|---|---|---|
| FR-001 | Ejecutar lecturas independientes sin esperas artificiales y omitir consultas sin IDs. | AC-001: pruebas con Supabase ficticio conservan filtros, resultados y errores; lecturas independientes se solapan. |
| FR-002 | Reducir el tiempo de lectura del correo con concurrencia acotada. | AC-002: lotes de 50, máximo cuatro lotes de mensajes simultáneos, últimos 1000 globales y adjuntos compatibles; errores visibles. |
| FR-003 | Evitar recargas duplicadas y respuestas obsoletas en el CRM. | AC-003: una lectura activa por pantalla; solicitudes idénticas comparten resultado; una lectura antigua no reemplaza la nueva; carga inicial del servidor reutilizada. |
| FR-004 | Evitar esperas indefinidas en las recargas del CRM y duplicados en Pipeline OS. | AC-004: timeout de lectura con error recuperable, polling tras completar la lectura, y refrescar Pipeline no dispara otra lectura por actualizar sus datos. |
| FR-005 | Evitar reconstruir el Resumen por diferencias de fechas entre servidor y navegador. | AC-005: HTML inicial idéntico en UTC/Bogotá, español/inglés; tras hidratar se conserva la hora local del navegador. |

Extensión de publicación autorizada el18/11: el usuario pide desplegar y verificar rapidez/sin errores. Baseline real muestra React418 en Resumen; prueba de render entre zonas horarias reproduce la discrepancia. FR-005 corrige ese defecto dentro de la verificación solicitada, sin cambiar reglas financieras ni guardar preferencias nuevas.

NFR-001: demostrar reducción de rondas secuenciales con latencia sintética idéntica antes/después; no equipararla a una medición de producción.
NFR-002: sin dependencias nuevas, caché compartida de datos personales, cambios de permisos ni reintentos automáticos de escrituras.

## Restricciones y riesgos

Hay WIP previo en crm.tsx, layout.tsx, supabase.ts, next.config.ts y archivos nuevos de otros trabajos: conservarlo. Mantener el cliente autenticado por solicitud. Eliminar cuellos de botella demostrados no permite garantizar tiempos de producción sin medir red, SQL y servidor reales.
