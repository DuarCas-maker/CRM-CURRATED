# Tareas y trazabilidad

2026-11-12 · STRICT · spec/design v1.

| Tarea | Resultado / Definition of Done | FR / AC | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| T-001 | Reglas puras: grupos con evidencia, comparación, filtros, métricas y prioridades; escenarios negativos probados | 003/006/008/009 | done | Pruebas nuevas y validación de datos documentadas en verification.md. |
| T-002 | Catálogo completo autenticado, sin truncamientos ni nuevos privilegios; pruebas de paginación y acceso | 003/005/009 | done | HTTP, paginación y catálogo sobre RLS real en PGlite con tres perfiles. |
| T-003 | Ruta aislada, navegación por niveles/árbol, diseño responsive y tema; acceso aditivo al CRM | 001/002 | done | Navegador a 360/768/1280 px, temas y teclado; solo acceso nuevo en CRM. |
| T-004 | Reutilizar expediente/Conversaciones/campañas/importación; acciones persistentes revisadas y errores explícitos | 004/005/007 | done | Dos hilos lender demo visibles, panel con pestañas, confirmación de verificación cancelada; regresión existente. |
| T-005 | Updates, indicadores y clientes con fuente/fecha y conteos comprobados | 006/008 | done | Reporte en navegador y pruebas de agregación/selección/fondeo. |
| T-006 | Pruebas, tipos, build, revisión de diff, QA visual y guía; registrar límites y reversión | 001–010 | done | 80/80, tipos/build/formato correctos, QA visual/teclado y guía; límites en verification.md. |

Implementación secuencial; no se delega ni se editan worktrees de otros frentes. Archivos reservados en design.md. No commits/push ni operaciones externas durante desarrollo.
