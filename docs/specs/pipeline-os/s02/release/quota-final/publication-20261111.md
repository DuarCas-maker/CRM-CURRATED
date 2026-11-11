# I05 — publicación conjunta autorizada

11/11/2026 · SDD STRICT. El usuario autorizó publicar la web y curated-worker y
validar ambos despliegues, conservando Gmail directo, Composio apagado y43
peticiones de Instantly, sin envíos ni repetir052.

## Preflight de publicación observado

- Remoto Git: `DuarCas-maker/CRM-CURRATED`, main en
  `00b00937b8de7eea1966a6b2c3189bf1c9db8023`; coincide con la base local.
- Las1044 fuentes del manifiesto I05 coinciden por SHA256; no se regeneraron SQL
  ni contratos. Ensayo exacto PG15 aceptado7/7, build Windows aislado código0,
  I04 heredado248 pruebas. No se repiten pilotos aceptados.
- Revisión del delta: rutas con sesión, rol, origen y cuerpo acotado; asociación
  v2 y checks opt-in; cuota v2 apagada conserva la reserva legada. La constante
  `composioProductOperationEnabled=false` se mantiene. Sin nuevos cambios de
  producto posteriores a las pruebas selladas.
- En Coolify existente, proyecto CRM - CURRATED / production, web
  `rv8rpfxhf0mbxprge6h6ki9c` y worker `vc4aybj4ucje7zstpsp3zboh`: ambos Running,
  repositorio correcto, rama main, commit HEAD y «Deploy on push (webhooks)».
- Worker: `WORKER_EXECUTION_MODE=paused`, valor de producción leído sin editar.
  En ambos recursos, búsqueda de variables `_ENABLED` muestra solo
  `GMAIL_HISTORY_ENABLED`: routing, cuota, conexión/checks/bindingv2 de Composio e
  Instantly webhook no están configurados y conservan su valor por defecto false.
  No se guardaron variables ni cambios en Coolify.
- Ambos recursos muestran imagen en ejecución recuperable00b0093, además de
  fb9f201 y0af77b7. Dockerfile y Dockerfile.worker existentes sin cambios,
  healthchecks y usuario no-root; .dockerignore excluye env reales y .local.
- 052 ya aceptada mediante aplicación y postflight remoto independientes:
  [constancia](application-20261111.md). No se repite SQL en esta publicación.

## Ejecución y validación

El push autorizado a main iniciará los dos builds Linux existentes. Publicar el
mismo commit en ambos recursos y comprobar Success/Finished, health y smoke
acotado sin autenticación ni operaciones de proveedor. No se publican política,
rutas, vínculos o flags, ni se reanuda el worker. Si un despliegue falla, conservar
el diagnóstico y la imagen anterior del recurso; no borrar datos ni revertir052.

La evidencia posterior se registrará junto a este archivo sin alterar las huellas
del manifiesto histórico de preparación. Hasta observar ambos despliegues y sus
health, no se declara la publicación completada.

## Preservación de artefactos al crear el commit

La revisión del índice detectó conversión CRLF→LF de dos JSON de evidencia I04.
Se añaden únicamente dos reglas `-text` específicas en `.gitattributes` para
conservar sus bytes sellados en Git, sin editar esos JSON ni código probado.
Esta diferencia de metadatos respecto a la instantánea histórica se registra
explícitamente; el resto de las fuentes y todos los artefactos052 se conservan.
El SQL052 exacto contiene un espacio en la línea46: se conserva como excepción
conocida de `diff --check`, porque ya fue ensayado y aplicado con esa huella.
