# Publicación y reversa

Destino existente crm.finlabinc.com/pipeline-os, Coolify rv8rpfxhf0mbxprge6h6ki9c, origin/main. Autorización expresa previa de publicar la tabla/filtros vigente; no se solicita otra vez. Preservar avances concurrentes. Reversa inicial: imagen 4d59ed4, conservando base/configuración. No hay SQL, migraciones, cambios de infraestructura, env ni proveedor autorizado en este arreglo.

1. Publicar primero observación acotada tras tests/tipos y revisar el SHA exacto en Coolify. No se declara arreglado.
2. Medir carga real usando filtros ficticios o vista agregada. No abrir terminal/env ni guardar leads.
3. Corregir la causa confirmada, completar regresión/checks/build y publicar solo delta propio por fast-forward.
4. Exigir Success del SHA, health200, protección anónima, tabla real y selección/reintento sin alerta dentro de 30s.
5. Registrar los resultados. Ante regresión, recuperar imagen anterior compatible sin revertir cambios ajenos ni base.
