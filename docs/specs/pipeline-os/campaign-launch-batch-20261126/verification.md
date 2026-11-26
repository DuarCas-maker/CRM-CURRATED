# Verificación

Antes: timeout nativo de 8.095 ms con 100 seleccionados/4.004 contactos ficticios. Producción mantiene statement_timeout autenticado de 8 s. No se intentó crear una campaña real durante el diagnóstico.

El parche final limita los cálculos a los contactos seleccionados, conserva un lector privado equivalente al catálogo vigente y materializa los resultados durante cada comprobación. Dos funciones existentes cambian; las firmas, propietarios y grants se conservan.

PostgreSQL 15 nativo final: 4.004 contactos ficticios/100 seleccionados, presupuesto sin ampliar de 8.000 ms. Antes: timeout a 8.115 ms. Después: creación y programación completas en 1.268 ms, cien snapshots de ingreso correctos, recibo repetido devuelve la misma campaña y cero campañas parciales tras el fallo anterior. Se probaron igualdad con el lector original, permisos del lector privado, negativos de MFA/rol/versión/duplicados/ingreso/elegibilidad, asignación al creador y reversa exacta, incluyendo cuerpos CRLF como los productivos. Cero outbox y proveedores. Evidencia: native-result.json.

Regresión: quince pruebas de flow y parche pasaron en la ejecución final; otras trece de HTTP, owner, funding, worker, readiness y rebotes pasaron en la ejecución conjunta anterior. La única falla de esa ejecución era una prueba de domingo con reloj fijo al 22/11 pero programación creada con el reloj real del 26/11. Se alinearon únicamente los datos de programación de esa prueba a su reloj simulado, conservando todas las expectativas; la prueba ahora pasa. No se alteraron reglas de producto por ese fallo.

TypeScript, build Next.js con webpack y diff --check pasaron. Revisión propia: sin cambios de límites, mensajes, proveedores o permisos de los lectores públicos; el lector privado se deriva del SQL autorizado con reemplazos exactos y revocación de acceso externo. Las restricciones no se omiten.

Respaldo de producción del 26/11, 19:49 UTC: 121.767.690 bytes, listado y decodificación verificados; no se probó restauración de desastre. La primera aplicación abortó íntegramente por diferencias CRLF en el cuerpo productivo; una lectura confirmó schema ausente y hashes originales. Se normalizó solo el texto utilizado para los reemplazos, conservando la definición original para reversa, y se repitieron pruebas unitarias y PostgreSQL nativo con esa variante.

A las 19:52 UTC se aplicó el parche final con guardia del catálogo y SHA256 idéntico al ensayo. Dos funciones cambiadas, lector privado sin EXECUTE autenticado y hashes finales verificados. Permanecen 4.040 contactos, 4.030 leads, 2.052 contactos con ingreso y dos bloqueos activos. Sin escrituras de datos de clientes. Evidencia: application.json. Publicación de la aplicación y comprobación de sesión pendientes.

Mantenimiento: si cambia campaign_prepared_leads o la puerta de first_contact_candidates, este lector privado debe conciliarse nuevamente; no es un cache de datos ni una fuente independiente de reglas.
