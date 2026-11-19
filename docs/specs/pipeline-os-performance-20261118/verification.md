# Verificación

Baseline en087e951, sesión humana existente con MFA, navegación GET desde el navegador. Mide navegación/observación, no SQL aislado ni p95. No se guardaron filas, cookies o credenciales.

| Lectura | ms observados | Resultado |
|---|---:|---|
| Board group=files |18862|JSON correcto,50 filas de242,44645 caracteres|
| Master default |24301|JSON correcto,4518 caracteres; navegación necesitó recuperación del timeout de control|
| Tareas default |29299|JSON correcto,19745 caracteres,total1988; recuperación del timeout de control|

La primera entrada SSR superó la espera de QA y después se observó cargada, sin alerta. No se atribuye un tiempo comparable a esa primera entrada. Durante las lecturas de API con navegación lenta se capturó el resultado final en el mismo bloque de medición después del timeout, sin convertirlo en error de aplicación.

H1/H2: bucles de lotes secuenciales y fases independientes serializadas. H3: evaluar Workspace inicial después de corregir Board. H4: bundle/render del cliente no explica por sí solo18–29s de API; no cambiar UI sin medir su contribución.

Pendientes: prueba roja, benchmark ficticio equivalente, presupuesto global, permisos/regresión, types/build, publicación/postflight.

## Regresión y comparación local

T-002: dos pruebas nuevas fallaron sobre087e951 porque Board alcanzaba10 consultas activas y Master12, mientras los lotes de conversaciones seguían seriales. La prueba de propagación de fallo ya pasaba. Tras la corrección, las15 pruebas iniciales de lectores/paginación pasan; el nuevo presupuesto se respeta y los lotes sí se solapan.

Benchmark offline con351 expedientes ficticios,10ms de latencia por consulta, reloj fijo y source exacta087e951 cargada en memoria: Board709→313ms (95 consultas); Master449→253ms (79); Tareas776→362ms (115). JSON completo idéntico por escenario (assert.deepEqual y SHA256). Pico nuevo6 frente a10/12/9. Son tiempos sintéticos, no producción. El script además compara los alcances/columnas/offsets de todas las consultas independientemente de su orden.

TypeScript pasó después de tipar correctamente el fixture. No se añaden dependencias, cachés compartidas, SQL o cambios de permisos.

Suite ampliada: **111/111 correctas**, cero fallos/omisiones,26 archivos, con Node22.23.4, guardia offline y loader CSS de SSR. Incluye financiación/RLS, HTTP/MFA/anon, Master, Tareas, correo, hidratación, flujo de expedientes e índice058 anterior. Build aislado Next16.3.8 correcto,60/60 páginas; TypeScript y whitespace correctos.

Después se detectó el avance remoto fea58d0 (observabilidad segura de Tareas, dos archivos), incorporado fast-forward sin conflicto y sin editar su contenido. No se accedió a sus registros privados. La comparación sintética vuelve a confirmar JSON y alcance idénticos; se repiten los checks afectados y el build sobre esta base final.

Revisión del diff: filtros/columnas/roles iguales; snippets de correo continúan después de paginar, sin credenciales o cuerpos adicionales. readPipelinePages no cambió. Promesas observadas por Promise.all; primer fallo rechaza trabajos en espera y una invocación posterior crea una cola nueva. Prueba de fallo y aislamiento nueva correcta.
