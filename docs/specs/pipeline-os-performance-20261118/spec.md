# Rendimiento de Pipeline OS — STANDARD

Base pública087e951. Trabajo en worktree propio; WIP del coordinador conservado. SDD + debugging sistemático. Autorización de implementar: usuario confirma «En todas las secciones» y «A) Sí, revisar y aplicar las mejoras». Continúa la revisión productiva y autorización de publicación de mejoras de velocidad de esta aplicación del mismo chat; no amplía permisos de SQL/proveedores/env reales.

FR-001: reducir las esperas de lectura comunes del tablero sin alterar datos, clasificación, permisos, conteos o paginación. AC-001: lotes de50 se pueden solapar con máximo4 por relación y6 consultas activas por lector; páginas de cada lote conservan orden/conteo exacto y rechazo de catálogo incompleto/cambiante.

FR-002: aplicar el mismo presupuesto a Master y solapar sus lecturas independientes, manteniendo filtrado antes de paginar y cuerpos solo de los mensajes visibles. AC-002: salida equivalente a la base para datos ficticios, límite global6 y pruebas de owner/ajeno/MFA/anon y HTTP existentes correctas.

FR-003: beneficiar entrada, grupos y Tareas abiertas mediante el lector compartido, sin duplicar consultas ni crear caché global. AC-003: resultados idénticos en comparación sintética y menor espera; baseline/postflight en producción de entrada/board/Master/Tareas, con UI completa y sin nuevos errores en recorridos revisados. Iteración2/AC-004,005: reducir las proyecciones de correo repetidas con una página autorizada completa, filtrada antes de mensajes/snapshot; el alcance de las otras consultas permanece idéntico. Fallback completo y errores comprobados según change-request.md.

No objetivos: rediseño, nuevos indicadores, alterar reglas financieras o de correo, SQL remoto, credenciales, transportes, worker/configuración, envíos, proveedores, dependencias. El rendimiento de otras rutas se conserva.

Clarificación1: todas las secciones de Pipeline OS, producción como entorno ya confirmado en esta conversación. Clarificación2: revisar y aplicar. No se pide repetir autorización para la misma publicación ya solicitada; cualquier nueva migración/operación externa necesitaría su aprobación específica.
