# MinIO para servidores sin x86-64-v2

La plantilla Supabase de Coolify utiliza MinIO RELEASE.2025-10-15T17-29-55Z
sobre UBI9. En el servidor de este despliegue falla antes de arrancar con
`Fatal glibc error: CPU does not support x86-64-v2`.

Este Dockerfile conserva los ejecutables y la versión exacta de esa imagen,
fijada por digest, y cambia la base a Alpine 3.22. Conserva el script de inicio,
certificados y licencias. Los volúmenes y las credenciales los sigue definiendo
el Compose de Supabase en Coolify.

Se inspeccionaron los dos ELF de la imagen amd64: ninguno contiene un
intérprete dinámico y ambos declaran `GOAMD64=v1`. La compilación ejecuta
`minio --version` y `mc --version` como comprobaciones sobre el servidor destino.
No hay Docker disponible en el entorno local de desarrollo; aún falta probar
la construcción y el servicio en el servidor real.

## Construcción en el servidor que ejecuta Supabase

Con el repositorio disponible allí, desde su raíz:

```sh
docker build --progress=plain -t curated/minio:2025-10-15-alpine-v1 infra/minio-compat
```

Si se usa un Dockerfile pegado por entrada estándar, usar el mismo contenido
con `docker build --progress=plain -t curated/minio:2025-10-15-alpine-v1 -`.

Continuar únicamente si finalizan correctamente las comprobaciones de ambos
ejecutables y la construcción de la imagen.

## Cambios en el Compose guardado en Coolify

En **ambos** servicios, `supabase-minio` y `minio-createbucket`, sustituir la
propiedad `image` y agregar `pull_policy` al mismo nivel:

```yaml
image: curated/minio:2025-10-15-alpine-v1
pull_policy: never
```

Conservar el resto de cada servicio: entorno, volúmenes, comprobaciones de
salud, dependencias, comando y entrypoint. Guardar y desplegar desde Coolify.
El servicio `minio-createbucket` ejecuta su propio script y termina; no es un
proceso permanente. Revisar sus logs para confirmar la creación del bucket.

## Comprobación del despliegue actual

```sh
docker logs --tail 60 supabase-minio-tzpxxufvp3zf6u7eyjdmxa4p
docker inspect --format '{{json .State.Health}}' supabase-minio-tzpxxufvp3zf6u7eyjdmxa4p
docker logs --tail 30 minio-createbucket-tzpxxufvp3zf6u7eyjdmxa4p
```

Comprobar que el servidor pasa a `healthy`, se crea el bucket y los demás
servicios arrancan. Después validar subida y descarga por Supabase Storage.

La imagen es local a ese servidor. Conservar este Dockerfile: al mover el
despliegue a otro servidor o eliminar la imagen local será necesario volver a
construirla. Para actualizar MinIO, revisar deliberadamente el digest y repetir
las pruebas de compatibilidad y almacenamiento.

Fuentes:

- https://github.com/coollabsio/minio/blob/main/Dockerfile
- https://github.com/minio/minio/issues/18365
- https://docs.docker.com/reference/compose-file/services/#pull_policy
