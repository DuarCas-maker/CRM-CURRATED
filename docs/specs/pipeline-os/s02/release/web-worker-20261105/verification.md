# Verificación — ABC-WW-20261105

05/11/2026 · SDD STRICT · [Alcance](spec.md), [diseño](design.md), [aceptación](acceptance.md), [tareas](tasks.md), [runbook](runbook.md), [manifiesto](manifest.json), [fuentes](sources.json).

## Resultado por tarea

| Tarea  | Estado y evidencia                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WW-T01 | Preparada: inventario previo del checkout y cotejo de payload100, soporte y datos operativos. HEAD e índice sin cambios.                                                                                                                                                             |
| WW-T02 | Preparada: 776 fuentes públicas copiadas a contexto privado, inventario SHA256 y archivo tar.gz de 3.163.193 bytes; listado del archivo verificado. Documentación de este incremento fuera del digest para evitar autorreferencia.                                                   |
| WW-T03 | Parcial para publicación: TypeScript correcto y entrada del worker compilada/analizada con esbuild, 41 archivos internos y dependencias externas declaradas. Sin ejecutar scheduler. Dockerfiles/manifests preservados. Build de imágenes Linux pendiente por entorno no disponible. |
| WW-T04 | Fixture nueva preparada para marcas/asignaciones, asociación Composio, correo y revisión de campaña; ancho 360/768/1280, idioma y estados seleccionables. **Inspección visual y teclado pendientes**: no se capturó una pantalla válida de la fixture.                               |
| WW-T05 | Preparada: runbook para mismo candidato de web/worker, SQL ya aceptado, configuración conservada, control de arranque/autodeploy y recuperación compatible. Sin operaciones remotas.                                                                                                 |
| WW-T06 | Preparada: hashes, archivo, enlaces y preservación auditados. El candidato es revisable; readyForPush/readyForDeployment=false por checks pendientes.                                                                                                                                |

## Checks ejecutados y alcance

- TypeScript: Node22.23.4, `tsc --noEmit --incremental false`, correcto. No hay cambios a producto que requieran repetir las pruebas funcionales ya aceptadas. Los 56 casos del comparador/migración y las pruebas funcionales previas se referencian como antecedentes con fuentes iguales, no como ejecuciones nuevas.
- Worker: compilación del grafo de worker/index.ts en copia privada, plataforma node22 y paquetes externos. Los 41 inputs internos se resuelven y todos los paquetes externos pertenecen a dependencias de producción o builtins. Esto no es una imagen Linux ni demuestra el arranque con configuración real.
- Host: mkdir profundo correcto; symlink de archivo reproduce EPERM; Docker no está disponible, inventario WSL termina sin distribución utilizable. No se repitió el build standalone anterior ni se cambió output/config para conseguir un pass. No instalación/arranque de WSL o Docker.
- Dockerfiles revisados: standalone/static/public, PDF local, no-root, puerto/health de web; producción con tsx y heartbeat del worker. Ningún CMD ejecuta SQL. Lockfile y versiones preservados. Las imágenes todavía no fueron construidas en este incremento.
- Fuente/archivo: rutas/bytes/SHA256 registrados; listado del tar contiene exactamente la selección. Se excluyen env reales, .local, .git, node_modules y artefactos de build. El contexto no contiene secretos de configuración; el escaneo de patrones de alto riesgo no sustituye una auditoría exhaustiva.
- La 049 y su postflight ya están aceptados por evidencia del operador. No se ejecutaron de nuevo en ningún entorno para preparar esta versión. Los fixtures visuales no ejecutan SQL.

## Limitación de computer use

El canal cua_repl agotó el tiempo de espera en el inventario inicial. La alternativa Windows @oai/sky respondió al inventario, pero el control de seguridad detuvo la observación de Chrome porque no pudo determinar su URL actual con suficiente confianza para aplicar la política. No se abrió una fixture ni se emitieron más acciones de Windows después de esa detención. No se actuó sobre páginas de otros proyectos, se cambió una configuración o se intentó eludir la barrera.

La regla de la skill computer-use y su guía obliga a parar los inputs cuando la herramienta termina el uso del equipo. Por eso el HTML compilado se entrega como fixture preparada y todos los casos de inspección siguen pendientes. SSR/compilar JSX no se cuenta como QA visual aprobada.

## Preservación y pendientes

Gmail directo continúa fijado en el escritor actual; no se añadió un selector de Composio. Las pantallas de asociación son administración técnica y no habilitan entrega. INSTANTLY_WEBHOOK_ENABLED no se activa. No se consultan flags reales ni se abren env con credenciales.

Instantly 43, cero peticiones nuevas; 49 hashes operativos intactos. Sin push, commit, despliegue, SQL remoto, envíos, verificación de leads, instalación ni arranque del worker. La pausa operativa reportada no se cambia.

Pendientes reales para promoción: build Linux exacto de ambas imágenes, inspección visual/teclado del delta, controles de concurrencia/transición no acreditados y ficha/orden operativo de la publicación. La preparación de esta versión y el SQL aceptado no se presentan como un despliegue completado. No se solicita permiso de push hasta tener un candidato promovible y un plan concreto de arranque.
