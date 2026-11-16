# Revisión del candidato

Modo revisión con `safe-code-review`. Alcance: fuentes, rutas, UI, proyecciones, permisos, migración 055 y reversa de este incremento. Revisado contra FR-01–07 y AC-01–07.

Correcciones incorporadas durante la revisión:

- La selección conserva alternativas también desde el control histórico. Bloqueo de operación y CAS impiden dos selecciones simultáneas; cada comando tiene idempotencia por usuario/solicitud. Una selección posterior a contrato no arrastra silenciosamente el contrato a otro lender.
- La gestión de nuevas evaluaciones usa al responsable actual y conserva permisos de remitente, marcas y validación documental. Los helpers de actor instalados por S01 se alinean de forma condicional; no se modifica `can_send`.
- Una evaluación duplicada del mismo lender no oculta la elegida: se prioriza la seleccionada al leer y escribir. Montos anteriores/nuevos quedan auditados. Un acuerdo no registra funding.
- Ofertas históricas no se atribuyen a una operación nueva ni por coincidencia de nombre. Correos en cola/inciertos no acreditan envío. Un informe rechazado no se etiqueta como obsoleto.
- Los campos escritos se conservan al resolver un conflicto. Cambiar lender/operación respeta la protección de cambios pendientes. Paginación de informes y metadatos evita perder aprobaciones anteriores.

No se identificaron bloqueos adicionales en el alcance local revisado. Límites: no se auditó todo el repositorio ni se validó el esquema remoto concreto 048–054/WIP de usuarios. La revisión de integración y la comprobación de producción siguen siendo gates de publicación, no evidencia ya obtenida.
