# Resumen de tareas abiertas

Nivel STANDARD · implementación local · v1 · 2026-11-18.

## Contexto y alcance

Pipeline OS muestra cinco etapas, pero no una tabla inicial de responsables, cuentas y actividad de leads. Se añade esa tabla antes de las etapas y una lista de leads filtrable al seleccionar al responsable. Se conserva el diseño, navegación y permisos actuales. No incluye envíos, cambios de asignación, migraciones, publicación ni proveedores.

## Requisitos y aceptación

| FR     | Requisito                                                                                                                         | AC verificable                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Tabla inicial con una fila por responsable y todas sus cuentas visibles, con desglose por correo.                                 | AC-001: incluye responsables/cuentas sin actividad y permite volver a todos.                                                               |
| FR-002 | Enviados coincide con la fuente de Campañas; respuestas cuenta leads únicos con respuesta recibida. Todo el historial registrado. | AC-002: usa campaign_contact_facts, sin contar borradores, pruebas o seguimientos como primeros envíos; deduplica contactos que responden. |
| FR-003 | Cinco columnas de etapas con las reglas existentes de Pipeline OS.                                                                | AC-003: cada expediente cuenta en su etapa actual; ofrece navegación con el responsable seleccionado.                                      |
| FR-004 | Selección dinámica de responsable y listado de sus leads; distinguir gestionados, sin gestionar y contestados.                    | AC-004: gestionado exige envío confirmado; búsqueda y paginación se aplican después de los conteos.                                        |
| FR-005 | Respetar los permisos y no entregar contenido privado innecesario.                                                                | AC-005: sesión obligatoria, RLS y proyección por rol; respuestas sin cuerpos de correo ni credenciales.                                    |
| FR-006 | Carga, error con reintento, vacío, teclado, móvil e idiomas existentes.                                                           | AC-006: filtros no muestran resultados de otro responsable al cambiar rápidamente; tabla con scroll contenido en 360/768/1280.             |

## Reglas

- Enviados usa contactos únicos con envío confirmado, exactamente como el resumen de Campaign Control que ya está publicado. Un contacto en varias campañas/cuentas cuenta una vez en el total, una vez por responsable y una vez en cada cuenta que lo contactó. Se conservan los hechos de campaign_contact_facts y la visibilidad de campaign_group_members; no se suman seguimientos.
- Los leads se atribuyen a su seller; los expedientes sin lead se atribuyen a su responsable actual. Las etapas siguen al responsable actual del expediente (closer_id o seller_id), como la pantalla existente.
- Un correo individual enviado también acredita gestión. Una respuesta humana recibida del contacto acredita respuesta, incluyendo respuestas negativas; se excluyen rebotes, automáticos e ignored.
- Las cuentas se asocian mediante owner_id y las cuentas utilizadas por las campañas de cada responsable. Sin asignación se muestra explícitamente.
- Los conteos usan el catálogo autorizado completo antes de paginar; errores de lectura no se convierten en ceros. Se conservan todos los cambios locales anteriores.

## Preguntas y respuestas — ronda 1 cerrada

| N.º | Pregunta                                               | Respuesta del usuario                                                                                                                      | Traza  |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | ¿Fila por responsable, cuenta o lead? Recomendación A. | A: responsable con sus correos debajo.                                                                                                     | FR-001 |
| 2   | ¿Contactos únicos o mensajes? Recomendación contactos. | Contactados debe usar el mismo dato de Campañas (leads enviados), distinguiendo cada correo; contestados son leads con respuesta recibida. | FR-002 |
| 3   | ¿Qué acredita gestión? Recomendación envío.            | A: al menos un correo enviado registrado.                                                                                                  | FR-004 |
| 4   | ¿Período? Recomendación todo.                          | A: todo el historial registrado en el CRM.                                                                                                 | FR-002 |

## Restricciones y calidad

Sin nuevas dependencias ni SQL. Lecturas autenticadas y metadatos mínimos; sin abrir .env ni iniciar worker. Los datos sintéticos son la única fuente de QA visual. No se inspeccionan datos reales de clientes. El catálogo puede requerir múltiples páginas; se falla explícitamente si cambia o no se puede comprobar su totalidad.
