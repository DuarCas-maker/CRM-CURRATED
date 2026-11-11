# CR-QGR01 y ADR-QGR01 — separar procedencia Google de admisión local

10/11/2026 · STRICT · decisión de alcance confirmada para preparar; diseño propuesto, implementación no autorizada.

## Cambio de requisito

Origen: el operador solicita simplificar el requisito interno del proyecto Google y reutilizar su conexión existente. La respuesta2 acepta un control conservador común, incluso para Gmail directo que pudiera compartir proyecto.

Se propone reemplazar para contratos nuevos la obligación de INT-FR07/09 y C-FR03/06 de aportar google_quota_project_id con dos conceptos separados: identidad/procedencia Composio obligatoria y política interna de consumo obligatoria. El identificador Google pasa a metadato opcional; su ausencia nunca se registra como una revisión OAuth positiva. Las specs y el SQL históricos no se reescriben al preparar este CR.

También se prepara reutilizar la conexión mediante C1/C2 sin alta OAuth. Existing en Connect mantiene su sentido de cuenta CRM; no se convierte en importación arbitraria de conexiones externas.

## Decisión técnica propuesta

Contrato v2 y agregado conservador único de tráfico Gmail de la instalación cuando la política se habilite, conservando límites por cuenta y por proyecto conocido en el camino directo. Candidato existente con tuple exacta, owner original, comprobación vigente y aprobación humana. La reserva común no demuestra saldo del proveedor.

| Alternativa | Evaluación |
| --- | --- |
| Mantener Google obligatorio | Compatible hoy, pero mantiene la dependencia manual que el operador pide eliminar |
| Eliminar el campo y omitir cuotas | Rechazada: rompe la admisión compartida y debilita el cierre |
| Inventar un Google ID o marcar procedencia revisada | Rechazada: evidencia falsa, buckets fragmentados y riesgo de cuota/costo |
| Bucket por buzón/Auth Config | Rechazada para proyecto desconocido: no acredita independencia física |
| Contrato v2 con grupo conservador | Recomendada; satisface la decisión2 y conserva protección, con posible ralentización |

Costo de cambio: medio/alto; afecta TS, UI, SQL, snapshots y evidencias. No es una edición aislada del formulario. Exige migración aditiva futura y ensayos; no exige crear proyecto Google ni otro Auth Config.

Consecuencias aceptadas: posible espera adicional de Gmail directo, metadatos Google aún desconocidos, migración de contratos y revalidación de asociaciones nuevas. No cambia contenido, permisos de marca o proveedor seleccionado. La identidad histórica de Daniel orienta la selección, pero no autoriza tráfico ni confirma grants actuales.

Revisar la decisión si se acredita separación real de proyectos y el agregado limita operaciones, si cambia el contrato externo o si se decide cambiar el techo local. Reversa: deshabilitar nuevas admisiones v2, conciliar in-flight y conservar DB/evidencia; restaurar binario anterior solo con compatibilidad acreditada. Nunca simular v1 rellenando un proyecto inventado.

Registro: spec/design/tareas/aceptación preparados; código/tests de producto/SQL/publicación pendientes. No aprobación de compra, API, migración o despliegue.
