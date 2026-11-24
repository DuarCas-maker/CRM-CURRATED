# Verificación

Diagnóstico real descrito en bugfix.md. No se confunde la salud /api/health con el éxito de la consulta de campañas.

## Checks locales

- Prueba nueva: igualdad exacta anterior/candidato y reversa en 24 combinaciones (cuatro actores, overview/filtros/búsqueda/paginación/detalle/leads), cuentas ocultas y denegaciones por MFA/anon/helper privado. Correcta en PGlite y PostgreSQL 15.19 nativo.
- Volumen nativo: 4.004 leads, 19 grupos, 804 destinatarios; JSON idéntico. Última medición: 2.653 ms anterior y 1.675 ms candidato. Sin proveedores ni acceso remoto. El primer ensayo midió 2.802/1.781 ms. Evidencia en native-result.json y native-initial-result.json.
- TypeScript --noEmit y git diff --check correctos. No hay cambio de Next.js/frontend, dependencias ni Dockerfile; no se requiere build de una UI nueva. Docker local no ejecutado.
- Regresión: 28 de 29 pruebas correctas (campaign-control, campaign-flow, campaign-flow-owner y prueba nueva). La prueba existente «CF SQL: Sunday final boundary...» de campaign-flow.test.ts:402 espera 23/11/2026 10:30, pero la ejecución real del mismo día ya pasó esa hora; obtiene 21:27:42.853. Esa prueba no carga el candidato. No se modificó ni desactivó la expectativa y se registra el fallo temporal como pendiente ajeno al lector.

## Guardas y revisión

La primera aplicación se revirtió completamente con CAMPAIGN_READ_ATTRIBUTES_CHANGED. La lectura posterior confirmó helper ausente y hashes originales. El diagnóstico en transacción ROLLBACK identificó únicamente posiciones internas :location en proargdefaults al enviar varios DDL en una sola petición. Se sustituyó esa comparación de representación interna por pg_get_function_arguments, manteniendo los demás atributos, owner, ACL y tipos. La igualdad real de defaults se verifica explícitamente. Se repitieron prueba funcional y ensayo nativo sobre la misma base local; los cuerpos de funciones permanecieron idénticos. Las guardas no se eliminaron.

Revisión de código: facts del overview se materializa una vez por grupo y se conserva DISTINCT por contacto del proveedor original; budgets usa cuentas distintas y mantiene can_sender antes de leer cupo. El helper privado vuelve a comprobar acceso y ocultación. No hay caché entre solicitudes ni ampliación de grants. La selección de grupos, filtros, métricas globales, datos de remitente y lógica de envío no cambian.

## Producción

23/11/2026 20:36:32 America/Bogota: SQL aplicado en transacción con hashes esperados. Atributos contractuales, owner, ACL, 4.030 leads, 1.554 verificaciones recuperadas y timeouts de roles intactos. Nuevos hashes y respaldo verificado constan en application.json y backup.json. Cero filas de cliente escritas, cero activaciones/envíos/verificaciones del agente.

La consulta autenticada que fallaba pasó a devolver JSON válido con 18 campañas, métricas y funnel de 4.030 leads; navegación completa observada 4.032 ms. Se usó página vacía para leer agregados sin registrar destinatarios. Los contadores operativos pueden evolucionar por campañas ya activadas por el usuario; no se fijan cifras históricas como si fueran constantes.

Comprobación visual final: resumen con 18 campañas, 17 activas, 1.218 disponibles, 45 pendientes y 823 enviados; 18 botones de resultados, sin banner de error. Se abrió una campaña, cargaron Primer envío y recordatorios, destinatarios y resultados, y se volvió al resumen sin errores. Captura campaigns-proof.jpg recortada para mostrar tarjetas y evitar datos de destinatarios. Los envíos que evolucionaron durante la revisión proceden del worker y de campañas previamente activadas, no de acciones de envío del agente.

Postflight adicional: helper no ejecutable por anon/authenticated/service_role; health=200, timeouts de roles siguen en 8s y las 1.554 verificaciones Bouncer están completed. No se aplicaron otras migraciones pendientes ni se reinició Supabase. La corrección SQL está activa sin requerir cambios de frontend o variables.
