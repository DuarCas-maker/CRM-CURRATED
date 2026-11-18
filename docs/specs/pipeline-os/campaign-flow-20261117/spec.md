# Flujo de leads y campañas — STRICT

Actualización CR-01: la respuesta 4B asigna los expedientes de nuevas campañas al creador, sustituyendo la conservación del asesor descrita en la versión inicial de FR-03/AC-07. El usuario confirmó conservar los cuatro intervalos; ver revisions/owner-creator/change-request.md. No reasignar historia.

Implementación y publicación coordinada en crm.finlabinc.com autorizadas por el usuario el 17/11/2026. No solicitar aprobaciones por archivo. Las pruebas y el smoke no verifican correos reales ni envían campañas. Se requiere respaldo reciente antes del SQL remoto.

## Requisitos confirmados

- FR-01: dos espacios dentro de Pipeline OS: preparar leads y campañas. Importar Excel con mapeo existente, deduplicación y botón «Importar y verificar», mostrando el máximo autorizado. Reutilizar válidos previos; verificar únicamente pendientes nuevos. Errores técnicos e inciertos conservan revisión manual.
- FR-02: pool de contactos válidos disponibles, búsqueda y selección por lotes de 20/50/100, sin incluir suprimidos, ya contactados, reservados o casos avanzados. Revalidación transaccional antes de activar.
- FR-03: crear una campaña por correo con un remitente autorizado, plantilla y fecha/hora de inicio. Nombre automático; conservar asesor del lead. Sin campos de responsable, zona horaria, ventanas ni límites. Mantener cupos y controles reales por debajo de la interfaz. Compatibilidad con campañas históricas y grupos de varios remitentes.
- FR-04: primer correo y cuatro recordatorios distintos, editables y previsualizables. Mismo remitente. Intervalos sucesivos +2/+3/+3/+5 días calendario desde el envío realmente confirmado anterior, misma hora local. Nunca enviar campañas en domingo; desplazar al lunes. Ejemplo: 17/11 → 19/11 → 23/11 → 26/11 → 01/12/2026.
- FR-05: respuesta personal, baja, rebote o meta alcanzada detienen recordatorios. No reintentar envíos inciertos. No seguimientos retroactivos para campañas existentes.
- FR-06: resultados por contactos: preparados, pendientes, enviados confirmados por Gmail, errores, rebotes, respondieron y sin respuesta; mostrar progreso de los cuatro recordatorios. Gmail aceptado no equivale a entrega ni apertura.
- FR-07: al confirmar el primer envío, expediente visible en Documentos pendientes, diferenciando sin respuesta/en proceso. Rebote marca incidencia. Documentos solo completos con reglas actuales de asociación y validación. Conservar Riesgo → Lenders → Ofertas → Cierre, sin demover casos avanzados.

## Fuera de alcance

SMS operativo, apertura de mensajes, cambios de cuotas, reconectar cuentas, envíos/consumos de proveedor durante QA, recordatorios históricos retroactivos, sustituir el motor de transporte o sus controles de marca/MFA.

## Criterios

AC-01: una importación autorizada solo encola contactos nuevos hasta su máximo; duplicados y reintentos no duplican cargos.
AC-02: un lote selecciona exactamente los contactos visibles elegibles; otro usuario o un estado cambiado es rechazado al activar.
AC-03: tres controles principales, preview visible y secuencia revisable; errores no borran configuración.
AC-04: calendario reproduce el ejemplo, conserva hora local y se ancla al envío real tras retrasos de cupo.
AC-05: respuesta/baja/rebote detienen mensajes pendientes incluso en el límite de despacho.
AC-06: métricas cuentan contactos únicos y distinguen primer envío de recordatorios; campañas antiguas permanecen consultables.
AC-07: el primer envío no completa documentos ni cambia asesor; los demás pasos mantienen sus permisos.
AC-08: permisos negativos, idempotencia, reversa, TypeScript, build y smoke de solo lectura pasan antes de cerrar.
