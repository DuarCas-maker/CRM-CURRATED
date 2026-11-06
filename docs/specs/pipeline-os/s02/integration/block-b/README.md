# Bloque B — marcas, asignaciones y autorización del envío

Actualización B2,31/10/2026: **B1/B2 implementados y probados localmente**. [Entrega B2 y límites](b2-verification.md), [huellas](b2-implementation.json):118/118 pruebas seleccionadas y TypeScript correctos. Guardas de preparación/snapshot/claim/admisión/conciliación, campañas y notificaciones; cero red/remoto/envíos, directo fijo, Composio deshabilitado e Instantly43. Siguiente incremento: C, asociación técnica Composio. Visual/teclado/build/catálogo/PostgreSQL multiconexión y promoción siguen pendientes. Las entradas siguientes conservan el estado histórico B1/preparación.

31/10/2026 · SDD STRICT · **B1 implementado y probado offline; B2 pendiente.** Base: bloque A integrado localmente más S02-I01. Gmail directo sigue siendo el único transporte activo; Composio permanece sin selector productivo e Instantly en43 peticiones. [Entrega y límites de B1](b1-verification.md).

| Incremento          | Entrega verificable                                                                                                                                                                                  | Límite                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| B1 — administración | Crear/renombrar/activar/desactivar marcas, asignar/revocar membresías y proponer/confirmar/descartar la marca de una cuenta con revisión, evidencia y MFA. Configuración y OAuth directo coherentes. | Solo comandos y gestión; no habilitable en el entorno por separado de las guardas B2.                        |
| B2 — despacho       | Snapshot de marca/autor/revisiones; campañas, borradores y outbox coherentes; validación en preparación, claim y corte final, también para campañas/tests/notificaciones de servicio.                | Dependencias externas falsas; no cambiar transporte, iniciar campañas o reanudar pendientes automáticamente. |

El usuario autorizó e implementamos **B1 local**, dentro de seis archivos existentes y ocho nuevos. [Huellas finales](b1-implementation.json). El siguiente incremento de código es B2, con revalidación del manifiesto y autorización propia; hoy sigue pendiente. [Tareas](tasks.md).

Documentos: [especificación](spec.md), [diseño](design.md), [aceptación](acceptance.md), [decisión de consistencia](adr-003-corte-de-autorizacion.md), [rollout y recuperación](rollout.md), [verificación](verification.md).

QA de preparación histórica:12 requisitos,12 escenarios y10 tareas. [Metadatos de esa preparación](preparation-report.json). Los resultados155/155 corresponden a A; las pruebas nuevas de B1 están separadas en su entrega. Revisión visual/teclado y empaquetado completo siguen pendientes.

Se reutilizan25A–30 de S01, D01–D24 y las aceptaciones del correo existente. No se pidieron credenciales, leyeron env reales o repitieron pilotos aceptados. SQL B1 se ejecutó exclusivamente en memoria sobre001–047+A; ninguna API/operación remota. El build completo de A sigue pendiente por EPERM Windows; B1 no lo corrige ni acredita un release.
