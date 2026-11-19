# Postflight — lectura del resumen excede el plazo del cliente

Síntoma observado tras fed1e49: health200, nuevo GET anónimo401 y filtros inválidos400; la pantalla publicada presenta el título nuevo pero no alcanza a mostrar la tabla y ofrece Reintentar. El mismo GET autenticado, navegado con owner/q sintéticos sin coincidencias, terminó devolviendo un resumen válido: 1988 leads, 227 enviados únicos, 5 con respuesta, tres filas de responsables y seis cuentas. No se guardaron filas, correos, cookies ni tokens.

## Diagnóstico

1. Consulta inválida o permisos: descartado como explicación de este intento; la misma lectura llega a un resumen válido con la sesión existente.
2. Versión no publicada: descartado; endpoint nuevo y título de la tabla presentes.
3. Trabajo de lectura innecesario supera los 30 segundos de WorkspaceReader: confirmado por el recorrido observado y el código. El agregador descarta hechos de campañas sin send_status sent, pero el lector los pide y pagina todos; además termina hechos de campañas antes de iniciar la lectura de correo, y procesa lotes independientes de IDs en serie. El navegador termina más tarde con JSON válido mientras el cliente ya canceló la petición. No se presenta esa observación como un benchmark SQL aislado.

## Corrección prevista

- Filtrar send_status=sent en el RPC existente; los leads pendientes siguen proviniendo del catálogo completo. Conteos y permisos se conservan.
- Ejecutar grupos/campañas/hechos y lectura de correo del board en paralelo cuando sus dependencias ya estén listas. Acotar a cuatro lotes/consultas por frente, sin concurrencia ilimitada.
- Abrir Tareas abiertas reutiliza los conteos del board ya cargado (group files); no pide de nuevo filas tasks que esta vista nunca muestra. Entrar a una etapa conserva su lectura y filtros normales.
- No aumentar el timeout ni modificar SQL, roles, variables, worker, transportes o datos de negocio.
- Regresión: 4000 destinatarios pendientes no deben generar páginas de hechos que el resumen nunca utiliza. Verificar conteos, permisos, tipos, build y la tabla real antes de cerrar el despliegue autorizado.

Se trata de la corrección del mismo alcance autorizado por el usuario; no de una funcionalidad adicional. La reversa identificada sigue siendo 7dde2e8, preservando cambios concurrentes.

Regresión ejecutada antes del arreglo: el caso de 4000 destinatarios pendientes falló por exceso de páginas RPC. Tras filtrar enviados, conserva 2 leads enviados únicos, el catálogo de 73 leads y exactamente tres páginas de hechos útiles. No se relajó la aserción ni se aumentó el timeout.

La corrección pasa 93 pruebas, TypeScript y build Node22.23.4. Antes de publicarla se conservó bd645bb (índice de contactos importados publicado por otro frente); no cambia fuentes de aplicación y no se aplicó ni repitió SQL desde este chat. Cinco comprobaciones de índice/esquema/etapas posteriores también pasan. Los tres archivos de código propios modificados son workspace.tsx (grupo de lectura al abrir tareas), pipeline-tasks.ts (filtro y concurrencia acotada) y su regresión de lector.
