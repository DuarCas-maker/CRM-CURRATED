# Resultado de rendimiento y publicación

Aplicación: https://crm.finlabinc.com. Fecha local18/11/2026, cierre19/11 UTC. Publicación autorizada expresamente por el usuario. Se mantuvo aislado el WIP del checkout principal.

## Cambios publicados

-70cee99: lecturas independientes en paralelo, correo por lotes acotados, coordinación de recargas sin duplicación/respuestas obsoletas y fechas estables durante hidratación.
-9cfdcc1: métricas agregadas seguras para identificar las consultas lentas, sin cuerpos/identidades/URLs privadas.
-8866e84: estadísticas legacy solo en vistas que las utilizan; colas/revisiones administrativas solo en sus pantallas y para superadmin.
-7dde2e8: corrección del receptor de fetch nativo al actualizar. Coolify Finished, healthy, rolling update terminado; navegación real correcta. Worker automático Running; sin cambiar su configuración ni ejecutar operaciones de negocio.
- Base de datos: índice parcial por contacto de import_rows con result='imported', aprobado separadamente, respaldo privado verificado y postflight correcto. Detalle y reversa en database/.

## Tiempos observados

| Lectura autenticada | Antes | Después | Cambio aproximado |
|---|---:|---:|---:|
| Resumen |16,995s|11,881s|30% menos|
| Oportunidades |13,577s|7,102s|48% menos|
| Leads |13,920s|3,947s|72% menos|
| Reportes |8,513s y timeout|5,627/5,913/5,729s,3/3 correctas|timeout no reproducido después del índice|

Son observaciones reales con sesión existente y navegación GET, que incluyen red, renderizado JSON y observación. Los tres primeros “después” se tomaron en8866e84;7dde solo corrige fetch durante refresh, conserva ese backend. No representan p50/p95, pruebas de carga ni promesa de duración para todos los usuarios.

## Verificación de pantalla y acceso

Tres cargas completas del Resumen SSR:10555/9393/9411ms sin error de carga ni React418 nuevo. Tras7dde, navegación a Oportunidades6850ms y Leads3301ms,100 filas cada una, carga finalizada y sin alertas o nuevos errores/warnings. Pipeline OS entró correctamente; una observación20,5s incluye recuperación del control de QA y no tiene baseline comparable, por lo que no se acredita mejora de ese tiempo.

Conexiones mantiene sus colas administrativas autorizadas; lectura4523ms sin error. Reportes/Indicadores se comprobó después del índice:3GET sin error y pantalla completa sin alertas/consola nueva. Último smoke anónimo: health/login200, Workspace/Pipeline/Master401/no-store y asset nuevo de fechas presente.

Checks finales sobre main fed1e49 más la migración058 y documentos propios: **98/98 pruebas**, cero fallos/omisiones, Node22.23.4 y guardia offline; incluye la regresión de Tareas incorporada por el avance paralelo, permisos, financiación, hidratación y el índice/reversa. TypeScript y sintaxis del aplicador correctos. Build web7dde previamente correcto con60/60 páginas; el cierre agrega SQL, pruebas y documentación, sin modificar las fuentes web del main actual.

## Límites y mantenimiento

No se declara que cada flujo de toda la aplicación haya sido probado ni que la infraestructura responda bajo cualquier concurrencia. Algunas cargas todavía tardan varios segundos. Permanecen lecturas de permisos por expediente; la observabilidad agregada ayudará a detectar futuros cuellos de botella sin exponer clientes. No se cambian credenciales, proveedores, campañas ni datos para esta optimización.

Reversa web: retirar únicamente los commits de rendimiento conservando avances posteriores de main, o usar la imagen anterior conforme al runbook; nunca reset/force-push. Reversa SQL: comprobar identidad del índice y usar database/down.sql standalone; no restaurar todo el respaldo para retirar un índice.
