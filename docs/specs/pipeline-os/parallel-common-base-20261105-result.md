# Apertura F2/F3 — resultado

BASE2-FR01–05 / AC01–05 comprobados localmente. Base común **50d2f916788c73c831d6e0ebe1cf29a1e9d6340a**, en `codex/s00-auto-receive`. Conserva el trabajo público anterior; es una base local de desarrollo, no una versión publicada.

| Frente | Chat abierto                              | Rama local                        | Escritura inicial permitida                   |
| ------ | ----------------------------------------- | --------------------------------- | --------------------------------------------- |
| F2     | Pipeline OS — Conectar Gmail con Composio | `codex/f2-connect-gmail-20261105` | `docs/specs/pipeline-os/s02/connect-gmail/**` |
| F3     | Pipeline OS — Piloto operativo y QA       | `codex/f3-pilot-qa-20261105`      | `docs/specs/pipeline-os/operations-pilot/**`  |

Los IDs y carpetas reales están en la [evidencia de apertura](parallel-common-base-20261105-result.json). Ambos chats comenzaron discovery y preguntas de clarificación. Sus decisiones pendientes corresponden al usuario; esta apertura no las responde ni autoriza implementar producto.

En cada worktree se compararon 797 archivos: 796 idénticos y uno equivalente al normalizar LF/CRLF, conforme al manifiesto. Las 100 fuentes del payload coinciden por bytes. Se comprobó la ausencia de los 49 registros privados del coordinador, siete rutas de env reales y node_modules. Las ramas separadas se crearon sobre la misma base, sin cambiar archivos. El worktree S01 anterior no se reutilizó ni modificó.

En el coordinador permanecen iguales el payload100, los 49 hashes operativos y el archivo del candidato ABC-WW-20261105. Gmail directo sigue seleccionado, Composio deshabilitado, Instantly43; cero peticiones nuevas a proveedores, SQL remoto, push o despliegues por esta apertura. No se arrancaron servicios ni se repitieron pruebas funcionales aceptadas.

El coordinador conserva la propiedad de código compartido, SQL, configuración y publicación. F2 y F3 proponen sus futuros cambios allí donde tienen permiso documental; se revisan e integran después. No ejecutar dos escritores sobre archivos compartidos. Build/QA de publicación y pruebas operativas reales mantienen sus pendientes y autorizaciones propios.

Siguiente paso: continuar las decisiones de alta Gmail–Composio en F2 y las del piloto en F3. Aquí se mantiene la coordinación de la versión A/B/C.
