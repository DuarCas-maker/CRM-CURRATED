# Verificación I05

11/11/2026 · SDD STRICT · preparación local. No prueba el estado remoto actual.

- Base sintética PG15.19: declaraciones001–050, permisos048 y corrección051,
  cuentas/brand/binding v1 y consumo legado ficticios. Solo binarios ya autorizados,
  clúster propio loopback y parada en finally; no instalación ni datos de F2.
- SQL052 EXACTO, preflight y postflight ejecutados en ese fixture. Seis escenarios
  más test padre:7/7,0 omisiones. Incluyen permisos, drift, cola, repetición,
  reversa posterior sin uso, rechazo con política publicada y ROLLBACK completo.
- La aplicación verifica huellas de catálogo no modificado y datos operativos,
  credenciales y consumo antes/después. El postflight verifica también cabeza sin
  política y ausencia de uso nuevo; no acredita flags de los contenedores.
- Build Windows aislado Next16.3.8 con Node22.23.4: webpack, TypeScript y49 páginas,
  código0. Fuente pública copiada y cotejada por hash; junction de dependencias
  del mismo checkout, cero env reales, red bloqueada y flags apagados. El código
  de web/worker coincide con el manifiesto de fuentes de publicación; los cambios
  de documentación/SQL posteriores al build se sellan por separado.
- Se preserva evidencia I04:248 pruebas/subpruebas aceptadas, fuentes cotejadas
  por hash en lugar de repetir pilotos y regresiones sin cambios de producto.
- Dockerfiles y .dockerignore existentes revisados: no-root, healthchecks,
  standalone/static/public para web, tsx y heartbeat para worker, sin SQL al inicio.
  La constante Composio sigue false; no se cambia configuración del producto.
- Catálogo comparado en contexto uniforme pg_catalog/pg_temp; LF/CRLF normalizado
  para funciones y orden de ACL por nombre, evitando variantes por OID/search_path.

## Límites y pendientes reales

Docker no está disponible en este host: no se construyeron ni ejecutaron imágenes
Linux. El worker no se arrancó. No se inspeccionaron Coolify, remoto Git, Supabase
real, flags, imágenes recuperables o cupo. No hubo push, commit, despliegue, SQL
remoto o llamadas de proveedor. El catálogo cubre el delta/dependencias y roles
de API declarados; no certifica todos los objetos o grants ajenos al contrato.

`publicationReady:false` es correcto. La preparación está terminada; aplicación,
build Linux, publicación conjunta, health y smoke permanecen como pasos remotos
posteriores. El riesgo externo de tokeninfo también continúa pendiente del piloto.

## Herramientas y evidencia

- `run-prepare.mjs`: genera contrato/SQL con PG15 propio y ejecuta el ensayo exacto.
  Requiere `PIPELINE_OS_QGR_PG_BIN` apuntando a los binarios existentes autorizados.
  Sin ese dato no descarga ni instala nada. Salida local en `.local/pipeline-os/qgr-i05`.
- `bundle-build.mjs`: sella fuentes públicas sin leer env; `--build` añade el build
  aislado local. No publica el archivo ni llama a Coolify/Git remoto.
- `manifest.json`: resultados, huellas, límites y rutas de evidencia observada.

La fase de publicación futura debe verificar otra vez las fuentes, el ordinal y
el remoto. No ejecutar 052 únicamente porque el ensayo local pasó.
