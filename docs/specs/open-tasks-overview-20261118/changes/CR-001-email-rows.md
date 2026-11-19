# CR-001 — Una fila por correo

19/11/2026. STANDARD para implementación; publicación del ajuste dentro del despliegue del mismo CRM ya autorizado. Base c0ef7a9. Sustituye FR-001/003/004 de la primera versión en cuanto a la agrupación visible.

## Requisitos confirmados

- EMAIL-FR01 / AC01: una fila por dirección normalizada (sin espacios externos, ignorando mayúsculas), con todas las columnas de estadísticas. Eliminar responsables, subgrupos y etiquetas Sin responsable/Santiago de esta vista, incluido el detalle.
- EMAIL-FR02 / AC02: Leads incluye enviados y pendientes vinculados a las campañas o conversaciones de la cuenta. No asignar un lead por el nombre o responsable del correo. Respuesta 1 → A.
- EMAIL-FR03 / AC03: cada lead cuenta una vez por correo; un lead compartido puede estar en varias cuentas, pero una sola vez en el total general. Varias campañas, alias de cuenta o seguimientos no lo duplican. Respuesta 2 → A.
- EMAIL-FR04 / AC04: enviados usa la misma evidencia de Campañas. Gestión, respuesta, fechas y filtro de estado de una cuenta solo usan los registros de esa cuenta, nunca la respuesta recibida por otro correo.
- EMAIL-FR05 / AC05: selección de correo, búsqueda, paginación, estados y etapas dinámicos, sin cambiar RLS/MFA ni volver a leer el tablero al filtrar. Conservar responsive, teclado, carga/vacío/error e idiomas.

## Diseño e impacto

Se añade byAccount al contrato de lectura con métricas completas y un ID estable basado en el correo normalizado. Se conserva byRep en el protocolo anterior para tolerar clientes abiertos durante el rolling update; deja de consumirse y de mostrarse en la nueva UI. La autorización interna por rol/propietario permanece intacta.

Se calcula actividad por par lead/correo, deduplicando IDs de cuentas que representan la misma dirección. La audiencia pendiente se obtiene de selected_contact_ids de campañas de primer contacto y campaign_enrollments, proyectando solo IDs bajo el cliente autorizado. Los hechos pesados conservan el filtro sent; no volver a paginar miles de hechos pendientes que ya están en el catálogo de leads.

Las etapas por cuenta se calculan sobre sus expedientes visibles distintos. Los botones de etapas filtran el mismo listado de leads por correo/etapa. Los totales generales conservan todos los leads autorizados, incluidos los que aún no tienen un correo vinculado; por eso no se suman filas para obtener el total.

Fuentes afectadas: agregador, lector, componente/CSS, integración puntual en workspace, pruebas/fixtures propios. Sin dependencias, SQL, escrituras de negocio, proveedores ni configuración. El root/WIP se conserva y el release se prepara en el worktree propio existente.

## Tareas y verificación

1. EMAIL-T01: regresiones de correo duplicado, cuentas alias, audiencia pendiente, leads compartidos y actividad cruzada (FR01–04).
2. EMAIL-T02: agregación/lectura autorizada con catálogo completo y páginas/errores preservados (FR02–05).
3. EMAIL-T03: filas de correo, detalle sin responsables y filtros/etapas coherentes (FR01/05).
4. EMAIL-T04: tipos, suites relevantes, build aislado, QA ficticia 360/768/1280 y teclado/estados; revisión del diff y preservación del WIP.
5. EMAIL-T05: publicar el delta revisado mediante el pipeline existente, confirmar SHA Success/health y probar tabla/filtros sin guardar datos de clientes. Registrar resultado real.

Reversa: volver a la imagen anterior c0ef7a9 o revertir únicamente CR-001 sobre el main vigente, preservando cambios concurrentes; sin restaurar datos ni force push. Riesgo principal: atribución incorrecta entre cuentas compartidas, protegida por pruebas de actividad y respuestas por cuenta. El coste de lectura se valida con el fixture y el postflight; el timeout no se aumenta.
