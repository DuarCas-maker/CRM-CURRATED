# Protocolo propuesto — construir sin publicar ni arrancar

**CB-20261106-r1 · 06/11/2026 · NO EJECUTADO.** [Spec](spec.md), [política y límites](design.md), [aceptación](acceptance.md), [verificación](verification.md), [manifiesto](manifest.json).

Este archivo no autoriza comandos remotos. No hay aún aprobación de construcción, constructor temporal, traslado, descargas, inspección o limpieza. La ejecución requerirá un alcance concreto con ventana y operador. No usar esta preparación como instrucción de Redeploy. Tampoco instalar Buildx si falta.

## 0. Estado recibido y condición de entrada

La lectura del operador acredita arquitectura linux/amd64, Docker29.7.2,4CPU, RAM5.8GiB con2.4GiB available, swap4GiB/usada1.7GiB,76GB libres en raíz y33 contenedores activos. Images18.66GB, volúmenes9.391GB, caché0. No se suman los overlays como discos independientes. Se conserva el resultado resumido en manifest.json sin IDs de contenedores ajenos.

El disco no requiere una limpieza para este protocolo. **La RAM reportada no pasa el inicio propuesto de3GiB available.** No iniciar nada por ese snapshot. No detener servicios ni tocar swap para alcanzar el umbral. Una ventana menos cargada o una estrategia revisada exige nueva evidencia.

## 1. Preflight futuro, solo lectura

Estos comandos están propuestos para la terminal del **host** server1 del CRM, no dentro del contenedor web:

```bash
uname -m
docker version
docker buildx version
docker buildx ls
docker context show
docker info --format 'OS={{.OSType}} Arch={{.Architecture}} CPUs={{.NCPU}} Cgroup={{.CgroupVersion}} MemoryLimit={{.MemoryLimit}} SwapLimit={{.SwapLimit}} Root={{.DockerRootDir}}'
nproc
free -h
vmstat 5 13
df -h
docker system df
command -v tar sha256sum timeout
```

Registrar fecha America/Bogota y versión exacta Buildx; no asumir el plugin por tener Docker. Confirmar el disco que contiene DockerRootDir, ausencia de warnings de límites, contexto default del host esperado y ninguna construcción concurrente de Coolify/otro operador. Para cambios automáticos: coordinar una ventana sin builds/deploys; este protocolo no cambia sus interruptores.

Tener dos terminales operativas: A ejecuta, B vigila memoria/paginación/disco y puede cancelar. Medir MemAvailable durante60s antes de **cada** imagen; descartar primera fila promedio de vmstat. Criterios exactos en design.md. Si falta herramienta ya instalada, parar; no descargarla.

Gates adicionales antes de ejecutar: imagen BuildKit compatible fijada por digest, egress limitado y demostrado para el builder, dos variables públicas web revisadas privadamente, hashes correctos, operador disponible, permiso de las descargas/recursos temporales y capacidad actual. No se validan llamadas a proveedores para comprobar estos gates.

## 2. Traslado e identidad de fuente

Tras autorización futura, trasladar por un canal privado ya disponible el archivo `.local/abc-release-20261105/abc-web-worker-sources.tar.gz`, más el inventario sources.json separado. No usar git pull/main ni hacer push para conseguir las fuentes; el commit común tiene documentos posteriores.

- Archivo esperado:3163193 bytes; SHA256 `abf0979c698e430671e57c3a2aae75053ee327b729555e36f7c072421fca9718`.
- Árbol de776 fuentes: `8c9690dbe5c4421f709608f5e51062a140f42f3b62ddabd1ff586d7885ad6710`.
- Verificar también el inventario sources.json contra el manifiesto padre, no confiar en un JSON recibido sin identidad. No extraer sobre una carpeta existente.
- Directorio propuesto: `/var/tmp/crm-abc-build-20261106-01`, con contexto `context/` y evidencia `evidence/` separados. Si ya existe, detenerse y conciliar; no borrar/sobrescribir.
- Antes de extraer, comprobar listado/rutas relativas, ausencia de `..`, rutas absolutas, symlinks peligrosos, env reales, node_modules y .local; cotejar después776 rutas y SHA por archivo contra el inventario. Una diferencia bloquea.
- No copiar el directorio entero del coordinador, dependencias Windows ni configuración de Coolify. No modificar los Dockerfiles o package/lock dentro del contexto.

El traslado/verificador por archivo aún no está automatizado en este incremento. No continuar hasta tener ese cotejo documentado por un procedimiento revisado; no improvisar un parser en producción.

## 3. Constructor propio — ejemplo futuro condicionado

El nombre propuesto es `abc-bld-20261106-01`. Comprobar que no exista. El archivo buildkitd.toml del ensayo, fuera del contexto, contendrá:

```toml
[worker.oci]
  max-parallelism = 1
```

Ejemplo para revisión, no para pegar hoy. Las variables deben apuntar al directorio/imagen por digest ya comprobados; no habilitan descarga por existir:

```bash
docker --context default buildx create \
  --name abc-bld-20261106-01 \
  --driver docker-container \
  --driver-opt "image=${ABC_BUILDKIT_IMAGE:?digest compatible pendiente}" \
  --driver-opt memory=2g \
  --driver-opt memory-swap=2g \
  --driver-opt cpu-period=100000 \
  --driver-opt cpu-quota=100000 \
  --driver-opt restart-policy=no \
  --buildkitd-config "${ABC_BUILD_ROOT:?directorio pendiente}/buildkitd.toml" \
  default
```

Este esqueleto **no incorpora por sí mismo el filtro de egress**. Antes de crear/bootstrap, completar y revisar los controles del builder/red propios sin reglas globales o redes de negocio. No ejecutarlo con egress abierto por omitir esa precondición. No `--use`, cambiar contexto global ni reutilizar el builder de Coolify.

Bootstrap posterior, bajo ese alcance, crea/inicia el contenedor BuildKit y su estado, no la aplicación:

```bash
docker --context default buildx inspect abc-bld-20261106-01 --bootstrap
```

Identificar ID/nombre reales del contenedor creado, su volumen propio y mounts, sin asumir nombres generados. Revisar Memory2147483648, MemorySwap2147483648, CpuPeriod100000, CpuQuota100000 y RestartPolicy=no con inspect acotado; corroborar cgroup/descendientes. No volcar env o inspect completo de contenedores productivos. Si no puede demostrarse el presupuesto efectivo, parar antes de compilar.

## 4. Web, un único intento

Revalidar memoria/ventana/egress y ausencia de tag destino. El operador dispone de NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY **públicas del CRM correcto**, no service_role ni claves de integración. No cargar/source de env reales, leer variables de contenedores, usar shell tracing o pegar valores en chat/logs. Registrar una huella de la configuración; la imagen debe quedar identificada como QA si son valores ficticios.

Ejemplo de comando futuro, con variables suministradas privadamente y evidencia fuera del contexto:

```bash
docker --context default buildx build \
  --builder abc-bld-20261106-01 \
  --platform linux/amd64 \
  --file "${ABC_BUILD_ROOT:?}/context/Dockerfile" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --label org.finlab.abc.source-tree=8c9690dbe5c4421f709608f5e51062a140f42f3b62ddabd1ff586d7885ad6710 \
  --tag crm-abc-web:cb-20261106-01-8c9690dbe5c4 \
  --load --progress plain \
  --iidfile "${ABC_BUILD_ROOT:?}/evidence/web.iid" \
  --metadata-file "${ABC_BUILD_ROOT:?}/evidence/web.metadata.json" \
  "${ABC_BUILD_ROOT:?}/context"
```

Capturar stdout/stderr y código real de build, sin que tee lo sustituya: si se usa pipeline en Bash, habilitar pipefail y capturar inmediatamente PIPESTATUS[0]. No se entrega un runner/watchdog implementado por este documento. A los45min cancelar aunque esté descargando. El monitor aplica los criterios de la sección6. No confundir límites del solver con ausencia de paralelismo interno de Next.

## 5. Control intermedio y worker

Solo si web terminó con exit0, IID/metadata completos, fuente/base acreditadas y sin incidentes: guardar mediciones, revisar nuevo uso de disco y repetir la admisión de60s. Conservar los límites. Si la web falla o agota RAM, detener el ensayo sin subirlos y sin construir worker.

```bash
docker --context default buildx build \
  --builder abc-bld-20261106-01 \
  --platform linux/amd64 \
  --file "${ABC_BUILD_ROOT:?}/context/Dockerfile.worker" \
  --label org.finlab.abc.source-tree=8c9690dbe5c4421f709608f5e51062a140f42f3b62ddabd1ff586d7885ad6710 \
  --tag crm-abc-worker:cb-20261106-01-8c9690dbe5c4 \
  --load --progress plain \
  --iidfile "${ABC_BUILD_ROOT:?}/evidence/worker.iid" \
  --metadata-file "${ABC_BUILD_ROOT:?}/evidence/worker.metadata.json" \
  "${ABC_BUILD_ROOT:?}/context"
```

Misma vigilancia, límite45min y captura de exit. Construir no ejecuta CMD worker/index.ts. La instalación pnpm dentro del build y las descargas solo se permiten en el alcance futuro; no se instala software del host ni se altera su daemon.

## 6. Monitoreo y detención

Terminal B: lecturas fechadas de /proc/meminfo, free, vmstat y disco del DockerRootDir a intervalos5s, más estado del builder. Guardar medidas fuera del contexto. No consultar health remoto o APIs para monitorizar. Cancelar ante límites de design.md, fallos de servicios observados por el operador, OOM, presión persistente, concurrencia inesperada o salida a destino no autorizado.

1. Cancelar el cliente del build en A con Ctrl+C.
2. Detener **solo el builder del ensayo** desde B, comprobando previamente su identidad:

```bash
docker --context default buildx stop abc-bld-20261106-01
```

3. Confirmar que su contenedor quedó detenido, que no queda trabajo RUN propio y que no continúa consumiendo. La desconexión/timeout del cliente sola no acredita esa detención. Si buildx stop no funciona, identificar el contenedor propio para una cancelación específica bajo la autorización; nunca parar Docker, Coolify u otros contenedores.
4. Marcar stopped/failed, conservar logs y no reintentar/ejecutar siguiente imagen. Un build posterior puede reiniciar el builder; no ejecutarlo como comprobación.

## 7. Inspección de resultado sin ejecutar aplicaciones

Leer únicamente las imágenes del ensayo con `docker image inspect` y formatos acotados: IID, OS/Architecture, Config.User, Cmd/Entrypoint, Healthcheck y etiqueta source-tree. Esperado linux/amd64, usuario crm, web node/server.js y worker node/tsx/worker/index.ts; Dockerfiles conservados. No imprimir Config.Env con valores.

Para revisar archivos, el permiso futuro debe incluir crear contenedores de inspección **detenidos**, identificados y sin red, sin mounts/variables reales. `docker create` no ejecuta CMD; no `docker start`, `run`, `exec` sobre estas imágenes ni compose up. Copiar solo archivos esperados a evidencia y comprobar existencia/huellas: web `/app/server.js`, `.next/static`, public/pdfjs y public; worker `/app/worker/index.ts`, fuentes src y `/app/node_modules/tsx/dist/cli.mjs`. No declarar health/arranque aprobado por inspección estática.

El expediente final registra fuente/archivo, versions/digests de Node y BuildKit realmente usados, inputs públicos por huella, cgroups, tiempos/medidas antes-durante-después, exit por build, IID/metadata, inspección y todos los recursos creados. Comparar base Node entre imágenes. Sin registro remoto: RepoDigests puede estar vacío; no inventarlo a partir de IID. No ejecutar una app para comprobar el tag.

## 8. Cierre, recuperación y resultado

Detener el builder propio incluso con éxito; guardar evidencia y verificar que los servicios existentes no fueron alterados por comandos del ensayo. Imágenes locales quedan sin arrancar, con tags exclusivos y sin referencia en Coolify. No borrar ni podar imágenes/cachés/volúmenes: la retirada futura requiere autorización de IDs exactos del ensayo y de sus contenedores de inspección detenidos. Nunca `system prune`, `compose down`, borrar DockerRootDir o cambiar límites de otros procesos.

Recuperación de este ensayo: cancelar y detener el constructor propio, conservar fuentes/logs, revisar el fallo y proponer siguiente acción. No hay rollback SQL/app, restart de servicios o reanudación de jobs. Dos builds correctos permiten revisar empaquetado; QA visual/transición, commit publicable, push/deploy/arranque y piloto siguen siendo gates separados.

Presupuesto futuro: hasta2 builds secuenciales, hasta90min de compilación más pre/postflight, descargas públicas de tamaño aún desconocido y recursos temporales propios. **Cero peticiones Instantly, cero Gmail/Composio/Bouncer/Supabase de negocio, cero envíos y cero SQL.** No se garantiza costo de red/capacidad del VPS a partir del snapshot; no contratar ni activar servicios pagos.
