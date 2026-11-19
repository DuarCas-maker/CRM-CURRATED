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

## Segunda lectura productiva — diagnóstico acotado

087e951 terminó correctamente en Coolify, pero la UI aún agota los 30 s. Una consulta autenticada sin filas de detalle devolvió un resumen válido, con asOf 31.046 s después del inicio del navegador (aproximado por reloj entre hosts). No es un error de autorización ni de agregación.

Hipótesis pendientes: (1) lotes secuenciales del lector canónico del tablero; (2) una consulta individual lenta del catálogo; (3) coste acumulado de hechos de campañas. Se añade observabilidad del mismo tipo que workspace_read: exclusivamente nombre fijo de recurso, cantidad de llamadas y milisegundos. Sin IDs, filtros, URL, cuerpos ni datos personales. Se publica este diagnóstico para confirmar la causa antes del siguiente cambio; timeout y datos permanecen intactos. Tipos y seis pruebas relacionadas pasan.

La medición productiva de fea58d0 confirma H1: duración de petición 30039 ms; mail_conversations_visible acumula 10 llamadas, máximo 4463 ms y suma 36715 ms; cinco llamadas canónicas secuenciales y otras cinco del resumen. lead_workspace acumula 10813 ms (cuatro páginas) en paralelo; campaign_contact_facts solo 1138 ms (siete llamadas). La suma de lecturas concurrentes no equivale al tiempo de pared. La duplicación y serialización del correo dominan el camino crítico, no los hechos de campañas.

Corrección: el lector canónico ofrece una captura interna opcional de metadatos mínimos del correo; el resumen reutiliza esa misma lectura para respuestas/gestión. El HTTP del tablero nunca recibe esa captura. Sin captura se conserva la proyección anterior y solo outbound sent. Al capturar se incluyen inbound y los campos mínimos, mientras las reglas de señales/etapas siguen exigiendo outbound sent. El resumen vuelve a filtrar por casos visibles y área/rol antes de agregar. Los lotes de hasta 50 IDs se procesan de cuatro en cuatro, manteniendo paginación ordenada, conteo exacto y fallo ante cambios/incompletitud. Se elimina la instrumentación temporal.

Regresión vista fallar antes de corregir: una sola lectura de conversaciones por lote, con respuestas humanas preservadas. Nueva prueba de 251 casos observa exactamente seis lotes, máximo cuatro concurrentes y 251 casos contados. 95 pruebas relevantes pasan; tipos y build se vuelven a verificar. No hay SQL, timeout ampliado ni credenciales/configuración modificadas.

## Filtro de cuenta y lectura duplicada de UI

6ec093a se publicó correctamente y la tabla inicial se observó con nueve columnas e historial completo. Durante las selecciones apareció un error genérico a los nueve segundos; no se clasifica como timeout de 30 s. El mismo endpoint con owner/account/q sintéticos terminó correctamente en forma aislada. Antes de seguir, main recibió05e5c9c, conciliación concurrente del presupuesto global del lector con nuestro snapshot, conservada por fast-forward. Se verifican99 pruebas y tipos sobre esa base integrada.

El código y la reproducción ficticia confirman otra duplicación: cambiar owner desde Tareas dispara a la vez tasks y board group files. Ambos releen el catálogo completo del correo; el filtro de cuenta se realiza después de esas lecturas. Se elimina el GET redundante del tablero mientras Tareas es la vista activa. Las tarjetas/strip utilizan los conteos por responsable del mismo resumen; al entrar en una etapa se conserva el GET del tablero y sus filtros normales. Seleccionar un responsable/cuenta desde una etapa vuelve al resumen de Tareas.

QA local con fetch ficticio y CSP connect-src none: antes del arreglo seleccionar la cuenta Santino incrementó a1 las lecturas redundantes del tablero; después queda en0 al cambiar Santino/Samuel, estado Gestionados y búsqueda. Entrar a una etapa produce exactamente1 lectura necesaria. Se mantienen selección y conteos de etapas. Build/tipos y25 pruebas relacionadas posteriores pasan. La causa exacta del fallo HTTP intermitente no se atribuye a un código SQL sin evidencia; sí queda comprobado y corregido el trabajo duplicado de UI.
