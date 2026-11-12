# Publicación de Pipeline OS y correcciones QA

12/11/2026 · SDD STRICT · protocolo y preflight previo a la publicación.

## Autorización y alcance

El usuario solicitó publicar la versión probada en producción y confirmó: «Revisa que el worker siga pausado y continúa con la publicación en main para verlo en producción». La autorización comprende el avance de main y sus dos despliegues automáticos existentes. La aclaración de destino queda cerrada al comprobar repositorio, rama y recursos; no se solicita otra aprobación para esta misma publicación.

Se publican el módulo aditivo Pipeline OS, sus fuentes locales/fonts, sus cinco archivos de pruebas, el acceso desde el CRM y las correcciones QA-F01/02/03: eliminación de propietarios adicionales conservando datos, nombres accesibles de los modales y descubrimiento de pruebas TS/TSX con guard público de tests. Los módulos previos de Conversaciones y el worker no cambian de comportamiento.

Fuera del alcance: migraciones, variables remotas, claves, infraestructura, activación de Composio/Instantly, verificación paga, envíos, reanudación de jobs y documentos WIP de otros frentes. La publicación no acredita un piloto real de proveedores.

## Destino y preflight observado

- Repositorio público `DuarCas-maker/CRM-CURRATED`; única rama de producción verificada: **main**. Base remota comprobada: `77f495cf2d9fb7d228a4fd52934b58c1022f53b7`.
- Coolify 4.7.5, proyecto **CRM - CURRATED**, entorno **production**, servidor de despliegue existente `localhost`.
- Web **CRM CURRATADED**, recurso `rv8rpfxhf0mbxprge6h6ki9c`; dominio `https://crm.finlabinc.com`; repositorio correcto, `main`, revisión `HEAD`, auto deploy `Deploy on push (webhooks)`.
- Worker **curated-worker**, recurso `vc4aybj4ucje7zstpsp3zboh`; mismo repositorio/main/HEAD y auto deploy. Se filtró exclusivamente `WORKER_EXECUTION_MODE` en Production y se comprobó **paused**, disponible en runtime, sin actualizar la variable.
- Rollback de ambos recursos muestra la imagen **77f495c** en ejecución, junto a versiones anteriores recuperables. No se pulsó Rollback, Redeploy, Restart, Save ni Update variable durante el preflight.
- La versión candidata conserva Dockerfiles, lockfile, `.dockerignore`, configuración de servidor, fuentes de worker y SQL. No introduce variables de entorno.

## Requisitos, aceptación y tareas

| ID / tarea            | Criterio de aceptación                                                                                        | Evidencia / estado al fijar candidato                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PUB-FR01 / AC01 / T01 | Selección explícita de las fuentes del módulo y las nueve fuentes de la corrección; sin WIP ajeno ni secretos | Manifiestos de módulo y correcciones; índice inicial vacío; hash del catálogo final en `publication-manifest.json` |
| PUB-FR02 / AC02 / T02 | Código idéntico al snapshot de QA, admitiendo solo normalización LF declarada                                 | 638 archivos públicos cotejados; 1.421 aprobadas, 0 fallos, 6 omisiones PG15; tipos y build correctos              |
| PUB-FR03 / AC03 / T03 | Destino, main/HEAD, imagen recuperable y worker paused comprobados antes de publicar                          | Lectura del Coolify existente y main remoto; sin guardar configuración                                             |
| PUB-FR04 / AC04 / T04 | Avance fast-forward de main al commit exacto, con comparación de base; ambos builds Linux correctos           | Autorizado; ejecución y resultado se registran en el acta posterior                                                |
| PUB-FR05 / AC05 / T05 | Web saludable, recursos nuevos accesibles y acceso protegido; worker nuevo sigue pausado                      | Smoke y lecturas posteriores pendientes al crear este protocolo                                                    |

## Diseño y decisión de publicación

**PUB-ADR01:** utilizar la rama y webhooks existentes de main. Un único avance de referencia publica el mismo commit para web y worker; no crear otra rama productiva, modificar el pipeline o forzar builds concurrentes. Reconstruir el worker conserva `paused`; no autoriza activarlo.

El cambio es compatible con la base ya instalada: reutiliza las tablas, políticas y comandos actuales. No hay expansión/contracción de esquema ni escrituras de datos por publicar. Por ese motivo no se ejecuta un backup/migración de datos como parte de esta entrega; la reversa es de imágenes de aplicación y conserva los datos existentes.

La autorización de producción cambia el alcance de entrega anterior (solo local), no las decisiones D01–D24, los contratos de seguridad o el alcance de funcionalidades. `spec.md`, `design.md`, `acceptance.md`, las tareas y la verificación del módulo siguen siendo los artefactos funcionales; este documento añade el gate G6, la decisión de release y el runbook.

## Verificación reutilizada por hash

- Suite posterior a las correcciones: **168 archivos, 1.427 pruebas enumeradas, 1.421 aprobadas, 0 fallos y 6 omitidas**. Las seis omisiones son casos opt-in de PostgreSQL 15 nativo; las rutas/esquemas de esos incrementos no se modifican aquí.
- `next typegen`, TypeScript final y `next build --webpack`: salida 0. Build Windows de fuentes completas con Node 22.23.5 y configuración ficticia. No se presenta como build Linux/Turbopack.
- Seis recorridos de propietarios y seis de modales, incluido un modal compartido dentro del expediente de Pipeline OS. QA visual 360/768/1280 y consola inspeccionada sin errores.
- Auditoría previa: 47 migraciones en PGlite y carga de 50.000 filas aprobadas. No se repiten por una entrega que no cambia la base ni el importador.
- Evidencia extensa conservada localmente en `docs/specs/pipeline-os/application-qa-20261112/`; los logs crudos, capturas, rutas de runtime y copias temporales no se incorporan al commit público. El manifiesto de esta publicación registra los resúmenes y hashes necesarios.
- El índice conserva exactamente las dos licencias OFL suministradas con las fuentes. Cada una contiene un espacio final en su línea 21; se documenta esa excepción de whitespace sin modificar el texto original. El resto del chequeo de whitespace debe pasar.

## Runbook autorizado

1. Verificar main remoto en la base indicada, fuentes de producto contra la copia probada y estado inicial del índice. Seleccionar rutas explícitas; excluir los cuatro documentos release preexistentes y todo el scaffolding local de QA.
2. Registrar el árbol canónico del índice y sus hashes. Crear los blobs/árbol/commit mediante la conexión GitHub disponible y cotejar el árbol devuelto con el local. La creación de objetos sin referencia no inicia un despliegue.
3. Revalidar main y mover su referencia con `force=false` y la base esperada. Si la base cambió, detener el avance y revisar el delta; no hacer force-push ni descartar cambios.
4. Observar los dos despliegues automáticos en Coolify. Conservar su cola/orden; no pulsar Redeploy adicional si ya existe un despliegue del nuevo SHA.
5. Confirmar Success/Finished, commit, health y rolling update de ambos. Leer el mensaje no sensible del nuevo worker para comprobar `Execution mode: paused`.
6. Ejecutar smoke anónimo de lectura: `/api/health` 200, `/login` 200, `/api/pipeline-os` 401 sin sesión, `group=invalid` 400 y fuentes WOFF2 nuevas 200. Abrir `/pipeline-os` para verificar la redirección de acceso. La demo se prueba únicamente si ya está habilitada; no habilitarla como parte de esta publicación.
7. Registrar commit, IDs de despliegue y resultados reales. Conservar el acta posterior local para evitar un segundo deploy por documentación. Sin envíos, análisis real o datos de cliente en evidencias.

## Riesgos y reversa

- El Dockerfile existente usa `pnpm build` en Linux. Los builds Linux de Coolify son un criterio de cierre; el build local con Webpack no los sustituye.
- El arranque de un contenedor nuevo debe mostrar el worker pausado. Si no lo hace, no declarar éxito ni reanudar trabajo; revisar el estado con el operador sin inventar permisos de configuración.
- Si la nueva imagen web falla el healthcheck, conservar la imagen anterior que mantiene Coolify. Si falla un flujo crítico después del rolling update, usar **Rollback → imagen 77f495c** en los recursos afectados. Esa imagen ya se comprobó disponible. No revertir SQL, resetear recibos ni modificar flags para esta reversa.
- La publicación conserva la configuración actual. Integraciones y piloto autenticado siguen teniendo sus propios criterios y presupuestos.
