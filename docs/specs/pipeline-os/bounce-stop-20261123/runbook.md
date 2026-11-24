# Rollout y reversa propuestos

1. Completar código y pruebas offline/nativas, revisar fuente productiva y medir agregados sin repetir el problema de timeout del resumen de campañas. Leer las guías Next vigentes antes de tocar frontend/rutas.
2. Conciliar catálogo y respaldar producción. Preparar informe de rebotes históricos, con evidencia y conteos agregados. No cambiar datos durante el informe.
3. Publicar esquema expansivo y controles de envío primero; después receptor/parser y UI compatibles. Comprobar estados inciertos, locking y workers antes de conciliar historial.
   En una instalación nueva, aplicar en orden `up.sql`, `correlation.sql`, `thread-correlation.sql`; las revisiones tienen guardas del catálogo esperado. Producción tiene las tres aplicadas; comprobar el catálogo antes de repetir cualquier operación con resultado de red incierto.
4. Aplicar únicamente rebotes históricos correlacionados; cancelar pendientes comerciales afectados. No activar ni enviar campañas durante el postflight.
5. Verificar desde sesión real columna/detalle, denegaciones y control de selección/despacho usando evidencia histórica y pruebas sin POST a Gmail. No enviar correos deliberadamente a direcciones inválidas.

Rollback conserva evidencia y bloqueos de seguridad ya aplicados. No convertir cancelados/bounced a queued, borrar suppressions o reanudar secuencias. Si se revierte la UI/receptor, mantener la compatibilidad con los controles de bloqueo; si la versión antigua no los respeta, detener el despacho afectado antes del rollback. Restauración puntual de definiciones, nunca una restauración indiscriminada de datos ni un reenvío.

El usuario autorizó implementación, SQL, publicación y recuperación histórica en crm.finlabinc.com. Ejecutar `reconcileArchivedBounces('prepare')` dentro del worker publicado, revisar sus cifras agregadas y después `apply` sobre el plan privado exacto (modo 0600 en /tmp; vigencia máxima una hora). Ninguna fase llama Bouncer ni envía correos. No iniciar worker/index.ts como mantenimiento.

Un correo que ya pasó la última admisión antes de llegar el aviso no puede retirarse. Conservar la conciliación sending/uncertain y no repetirlo para probar.
