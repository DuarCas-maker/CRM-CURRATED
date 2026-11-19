# Diseño

Causa H1 confirmada por código y lecturas reales: readTable/readRows recorren lotes de50 secuencialmente. Board acumula fases de directorios/detalles → conversaciones → mensajes → UW/eventos → reviews, aunque varias son independientes. Master retrasa reviews y mensajes hasta terminar tablas ajenas. La latencia de la API con payload pequeño descarta al render del navegador como causa exclusiva.

Crear un presupuesto de concurrencia por ejecución del lector (máximo6), con cola FIFO y rechazo de pendientes al primer error; sin estado global entre usuarios o requests. Cada trabajo es un lote paginado completo. No paralelizar offsets: el siguiente offset depende de filas realmente devueltas y count exacto. Mantener límite50 IDs por filtro, orden estable, hasta100000 filas y las guardas existentes de catálogo.

Integración posterior: main avanzó a6ec093a, que añade tope4 por relación y un callback interno de correo reutilizado por Tareas. Se conservan ambos: helper readPipelineBatches aplica4 por relación dentro del presupuesto compartido6. El callback conserva las mismas columnas y lectura de inbound/outbound que6ec, se entrega en memoria antes de resolver Board y nunca se agrega al JSON público. pipeline-tasks.ts y su regresión se reciben íntegros, sin reimplementar su trabajo. La comparación final de código usa6ec como baseline; la comparación productiva histórica sigue siendo087e951.

Board: usar la cola para lotes, RPC de campaña y contactos. Solapar datos de UW/eventos/reviews y cadena conversación→mensajes con las otras relaciones. Mantener fallback de reviews solo por tabla ausente, comprobado dentro del trabajo.

Master: cola equivalente; iniciar conversaciones→mensajes y reviews junto a las tablas independientes. Conservar permisos por área, selección de archivo crudo exclusiva superadmin, rango temporal y cuerpos solo después de construir/paginar el dashboard. Tareas ya hereda Board; conservar su reparación087e951.

El inicio sigue leyendo Workspace y Board en paralelo; primero corregir el cuello de botella demostrado de Board/Master y medir. No introducir cachés con riesgo de obsolescencia o mezcla de usuarios ni cambios de SSR a ciegas. Documentación Next16 instalada sobre fetching/streaming/lazy loading revisada; no se cambia la UI por esta hipótesis de servidor.

Reversa: commit que retire solo scheduler y estos bloques manteniendo avances posteriores. No restauración de BD ni variables. Rollout por pipeline Coolify existente, con checks previos y postflight de lecturas/entrada; detener si cambia salida, permisos o aparece error nuevo.
