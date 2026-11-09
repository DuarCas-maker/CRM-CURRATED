# Diseño y ADR-CB01 — constructor separado y ejecución condicionada

## Arquitectura conservada

Web: Dockerfile multi-stage, Node22-alpine, pnpm11.19.0/lockfile, Next16.3.8 standalone y PDF local. Worker: Dockerfile.worker, dependencias de producción/tsx y worker/index.ts. Ningún CMD aplica SQL. Iniciar el worker puede llamar proveedores; construir su imagen no ejecuta su CMD.

El paquete sellado es el inventario de [fuentes](../sources.json), árbol8c9690dbe5c4421f709608f5e51062a140f42f3b62ddabd1ff586d7885ad6710, archivo abf0979c698e430671e57c3a2aae75053ee327b729555e36f7c072421fca9718. El commit50d2f91 conserva además documentos posteriores; no reemplaza silenciosamente ese contexto exacto. Los documentos de este protocolo viajan aparte y no entran en el digest de fuentes.

## Decisión ADR-CB01

Usar un builder Buildx `docker-container` exclusivo, con selección explícita por comando y sin `--use`. BuildKit tendrá un contenedor/volumen propios: son recursos nuevos del ensayo cuya creación/descarga requiere autorización futura. No es aislamiento de máquina; comparte kernel, Docker, disco e I/O con producción y no garantiza ausencia de impacto.

El driver documenta límites memory, memory-swap, cpu-quota, cpu-period y restart-policy. TOML `[worker.oci] max-parallelism = 1` acota el solver. No aplicar flags heredados de `docker build --memory` suponiendo que limitan BuildKit; no activar `--allow security.insecure` o `network.host` para el build. Registrar el carácter privilegiado del contenedor que administra este driver y verificar sus montajes; no conectar redes ni volúmenes de negocio.

Validar límites tras bootstrap en HostConfig y en el cgroup efectivo, incluida la pertenencia de procesos RUN al presupuesto del builder. Si el backend/kernel no los aplica, detenerse: no seguir con una promesa de límites. El control del Docker daemon, exportación/carga y E/S no queda totalmente limitado por la cuota del builder.

## Política de recursos propuesta

| Control                 | Admisión / valor                                                                | Detención                                                              |
| ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| RAM builder             | 2GiB; memory-swap igual a memory para impedir swap adicional de este contenedor | OOM o límites ausentes: detener y revisar, sin ampliar automáticamente |
| MemAvailable host       | mínimo3GiB en cada muestra durante60s antes de cada imagen                      | inferior a1GiB en dos muestras consecutivas de5s                       |
| CPU                     | cpu-period100000 / cpu-quota100000; solver1                                     | degradación de servicios u otro build concurrente                      |
| Swap host               | sin paginación sostenida en las muestras `vmstat`, descartando la primera       | si/so sostenidos positivos durante15s o degradación observable         |
| Disco del DockerRootDir | al menos20GiB disponibles al iniciar cada imagen                                | menos15GiB disponibles, o crecimiento del ensayo superior a15GiB       |
| Tiempo                  | máximo45min por Dockerfile                                                      | cancelar al vencer; no arrancar siguiente build                        |

Estos umbrales son una política conservadora propuesta, no un dimensionamiento medido de la app. La instantánea del operador (2.4GiB available) **no supera** el umbral de admisión de3GiB. Esperar una ventana que lo cumpla o revisar la estrategia; no detener contenedores, vaciar cachés del host ni cambiar swap para forzar un pass. No se garantiza que2GiB basten para Next.

## Egress, variables y reproducibilidad

Las descargas futuras de Node/BuildKit/pnpm/paquetes requieren autorización explícita y un control de salida del builder que permita únicamente sus registros/CDN acordados. El builder no pertenecerá a redes Coolify/Supabase de aplicaciones. Una red Docker separada **no** bloquea por sí sola APIs públicas: debe existir evidencia del filtrado efectivo antes de ejecutar dependencias/código. Si no se puede aportar sin tocar configuración ajena, detenerse y preparar el control en otro incremento. No se crean reglas globales ni proxies en esta planificación. No usar sondas contra Gmail, Composio, Instantly, Bouncer, CRM o Supabase reales para probar el filtro.

Web necesita NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY del destino correcto, fijadas en compilación. El operador las facilita fuera del contexto/env real, sin pegarlas en el chat ni activar shell tracing. No pasar service_role, API keys, cookies o tokens OAuth. Las variables públicas no sustituyen el filtrado de red. Si se usan valores ficticios, etiquetar únicamente QA y **no** promocionar la imagen.

Fijar antes del ensayo una imagen BuildKit por digest compatible con el plugin disponible y registrar el digest Node usado por cada build. `node:22-alpine` es mutable en el Dockerfile conservado: no prometer reproducibilidad binaria ni modificarlo por este protocolo. Si web/worker resuelven bases diferentes, detener la promoción y revisar. Sin `--push`; `--load` guarda el resultado localmente sin arrancar la aplicación. Conservar IID, digest de manifiesto si existe, materiales/provenance y huellas; un RepoDigests vacío no equivale a error de carga local.

## Alternativas y límites

Builder predeterminado de Coolify: descartado para este ensayo por no tener presupuesto propio acreditado. Windows actual: sin constructor Linux. CI/nuevo VPS: no configurados ni autorizados. `compose up`/Redeploy: ejecutan aplicaciones y quedan fuera.

No aplica: cambios de modelos/API/RLS, migración, frontend o accesibilidad nueva. No hay runtime de ensayo implementado. La vigilancia y cancelación son manuales con dos terminales; un watchdog automático sería otro incremento. Revisión técnica basada en [driver Docker container](https://docs.docker.com/build/builders/drivers/docker-container/), [paralelismo BuildKit](https://docs.docker.com/build/buildkit/configure/), [restricciones de recursos](https://docs.docker.com/engine/containers/resource_constraints/), [buildx build](https://docs.docker.com/reference/cli/docker/buildx/build/) y [buildx stop](https://docs.docker.com/reference/cli/docker/buildx/stop/), consultados06/11/2026.
