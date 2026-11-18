# Verificación

G0–G5 completados. Base 9d28d5a, worktree codex/campaign-flow-20261117. Publicación y SQL autorizados por el usuario; G6 pendiente de aplicación y despliegue. Dependencias enlazadas del incremento propio anterior, manifests idénticos; no dependencias nuevas ni .env real en el checkout.

| Alcance | Evidencia ejecutada |
| --- | --- |
| FR-01/02 | Multipart real con sesión simulada, cantidad exacta, bloqueo sin Bouncer; consentimiento SQL privado y acotado, idempotencia, reuso de válidos y exclusión de incertidumbre previa. Pool 20/50/100, roles/MFA negativos, selección duplicada/obsoleta rechazada. |
| FR-03/04 | Lanzamiento atómico y audiencia exacta; conservación del asesor y owner_locked_at. Reanudación no descubre destinatarios nuevos ni reactiva respuestas terminales. Calendario 2/3/3/5, domingo al lunes y cambio DST. |
| FR-04/05 | Claim y admisión de marca reales en fixture; mark_sent confirmado avanza una sola vez y desde la confirmación real. Domingo devuelve queued sin admisión/intento. Guard final repite fecha, paso, supresión y caso; no usa el booleano de compatibilidad cerrado. |
| FR-06 | Respuesta al recordatorio en otro hilo cuenta una vez y abre ese hilo. Autorespuesta y remitente distinto excluidos. El worker adjunta el hilo inicial solo para flujos nuevos; campañas históricas conservan su comportamiento. |
| FR-07 | Preparación sin contacto queda fuera de Documentos. Envío confirmado muestra expediente y estado de respuesta; casos con evidencia previa/avanzados se conservan. Documentos y autorización 055–057 permanecen vigentes. |
| AC-08 | 121 pruebas de regresión, 121 pasan, 0 fallos; ejecución offline con concurrencia 2. Incluye campaigns, lectores Pipeline/Master, importación y seguimiento. |
| AC-08 | tsc --noEmit exit0; next build --webpack exit0 (Node22). El build Turbopack local rechaza la junction de node_modules fuera del root; Webpack permite comprobar el mismo producto. Producción instala dependencias normales dentro de Docker. |
| AC-08 | PostgreSQL15.19 nativo: dos lanzamientos simultáneos sobre los mismos contactos, uno aceptado y otro rechazado; cuatro destinatarios exactos, asesor conservado, reversa limpia antes de historia. Orden de instalación real con 055–057. [Resultado](native-result.json). |
| AC-03 | CUA con componentes reales, SQL real y contactos ficticios: selección del lote, calendario, programación de 20, detalle de cinco pasos, búsqueda vacía, tamaños 50/100 y tema oscuro. Vista móvil sin desbordamiento; tablet efectiva768px. Capturas en screenshots/. No worker/proveedores reales. |

12 funciones productivas coinciden con la base local al normalizar saltos de línea. [Catálogo](catalog-production-preflight.json). El SQL aborta si cambian las cuatro funciones operativas que decora. No se modifica 056/057 ni las colas de lenders.

Respaldo nuevo de58.402.595 bytes, dentro del volumen PostgreSQL, verificado por listado y decodificación completa de pg_restore; no descargado. [Metadatos](backup.json). No equivale a restauración completa de desastre. Coolify dejó su interfaz sin terminar de cargar; se empleó la conexión administrativa existente para el respaldo, sin cambiar permisos, credenciales o configuración.

SQL congelado5239f1bc… aplicado: cinco funciones públicas decoradas, catorce funciones añadidas, cero cambios inesperados en las funciones previas. RLS habilitado, authenticated puede ejecutar el lanzamiento sujeto a MFA/rol, anon/service_role no; el schema privado y las escrituras de tabla siguen cerrados. [Aplicación](sql-application.json).

Pendiente G6: integración/push y comprobación de web/worker y sesión real de solo lectura. No se han activado campañas ni consumido Bouncer en producción durante este incremento.
