# Opciones dinámicas de financiación — STRICT

Implementación y disponibilidad en CRM autorizadas por el usuario, incluida recuperación del último Excel guardado sin duplicar leads. Se usan SDD, ingeniería Supabase y los componentes actuales. No se activan campañas ni se envían pruebas reales.

Clarificaciones: el usuario eligió cálculo por lead usando Monthly Income; delegó proponer fórmulas y aceptó 1×/2×/3× del ingreso, factores 1,30/1,35/1,40 y 26/39/52 semanas para 6/9/12 meses. Parámetros editables, importes USD y cuotas redondeados a centavos. Son escenarios ilustrativos sujetos a revisión, no aprobación crediticia ni APR.

- FR-001: guardar ingreso mensual positivo por identidad de correo normalizado y mostrarlo en la preparación de leads. Registrar procedencia; sin sobrescribir nombre, marca, propietario, validación, bloqueos o historial.
- FR-002: recuperar el campo Monthly Income del lote ya identificado de 2.122 filas. Rechazar importes inválidos; conflictos entre filas duplicadas se informan y no se resuelven por orden arbitrario. Actualización idempotente, sin crear contactos/leads ni verificar Bouncer.
- FR-003: cálculo determinista de tres escenarios; total=monto×factor; pago semanal=total/semanas. Datos ausentes o inválidos bloquean únicamente la estimación, nunca inventan cifras.
- FR-004: plantilla inglesa editable, basada en el correo adjunto, con saludo, empresa, tabla y asunto dinámicos; firma Gmail y botón dirigido al remitente seleccionado. Baja incluida. HTML de datos escapado.
- FR-005: configuraciones e ingresos se conservan por campaña nueva; cambios posteriores no alteran campañas/colas existentes. Plantillas anteriores mantienen su comportamiento.
- FR-006: reimportaciones futuras pueden actualizar el ingreso del correo existente, preservando unicidad, verificación y supresión.

No se deducen capacidad de pago, elegibilidad financiera o aprobación a partir del ingreso. No se cambia ningún estado financiero del expediente ni se reactivan secuencias.
