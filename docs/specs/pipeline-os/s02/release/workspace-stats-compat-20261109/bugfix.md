# WS-COMPAT — contador compatible con la visibilidad S01 (STRICT)

Modo: revisión autenticada y corrección local del bloqueo encontrado durante el siguiente paso de PUB. No autoriza aplicación remota, publicación, nuevos mensajes o reanudación del worker. Se conserva la decisión de lanzar con alta y operación Composio; un piloto directo no sustituye ese alcance.

## Evidencia y causa

La web publicada en 00b0093 muestra «No pudimos cargar el espacio», referencia 133942001. Los logs de ese contenedor registran `permission denied for table conversations`, operación `workspace_stats`, código 42501. El healthcheck público solo verifica liveness y no certifica una sesión autenticada.

La función invoker `workspace_stats` de 007 llama a `workspace_stats_base` heredada de 006. Esta última cuenta unread mediante `conversations.needs_attention`. El bloque A de 049 revocó deliberadamente la lectura global de conversaciones y concedió únicamente id/opportunity_id/account_id. La vista `mail_conversations_visible` ya ofrece needs_attention derivado del último mensaje visible por área. Ampliar el grant o cambiar a security definer evitaría las restricciones buscadas; se rechazan ambas alternativas.

## Requisitos, diseño y aceptación

- WS-FR01 / AC01: cambiar solo la relación del subquery unread de workspace_stats_base a mail_conversations_visible, manteniendo firma, defaults, idioma, estabilidad, invoker, search_path, propietario y ACL. El wrapper workspace_stats no cambia.
- WS-FR02 / AC02: no ampliar grants de tabla/columna, RLS, policies ni ejecutar escrituras de negocio. Usuario permitido ve el contador según su área; usuario ajeno ve cero; acceso a columnas raw sigue rechazado.
- WS-FR03 / AC03: guardas de sourceHash normalizado LF/CRLF, metadatos y privilegios previos; deriva desconocida falla y se revierte. Repetición de la versión ya corregida es inocua. Guardar recibo antes de COMMIT y verificar persistencia con postflight separado.
- WS-FR04 / AC04: preservar 048/049/050 y los contadores privados; Instantly43, Gmail directo conservado, worker paused, Composio/routing/webhook apagados. No repetir pilotos aceptados.

T01: reproducir 42501 sobre fixture 049/050. T02: generar parche de un objeto y pre/postflight/reversa desde la fuente histórica versionada. T03: probar roles, visibilidad por área, preservación y deriva con red bloqueada. T04: entregar artefactos y evidencia; revisión autenticada/piloto quedan pendientes de solucionar el bloqueo en remoto.

No se modifica Next/React, Auth, vistas ni el transporte. El ordinal 051 es una reserva local de esta corrección; no acredita historial de migración remoto. No se edita el catálogo final histórico de 049/050 para que acepte un cambio posterior.

## Aplicación y reversa propuestas

Con autorización de este SQL concreto y el destino Supabase self-hosted del CRM confirmado: ejecutar preflight.sql una vez, revisar readyToApply=true, aplicar 051_fix_workspace_stats_visible_mail.sql completo y después postflight.sql en una ejecución distinta. Worker permanece paused. No desplegar código para esta corrección SQL ni repetir050. No continuar ante deriva. Si el SQL falla, limpiar la transacción con ROLLBACK y conservar el error.

La reversa `rollback.sql` solo restaura la fuente histórica de ese contador, verificando que la versión actual sea la corregida y preservando ACL. Devuelve el bloqueo de carga y por tanto se reserva para una regresión del parche; no es una solución operativa. No revierte mensajes ni datos. Para limpiar una transacción abortada usar `cleanup.sql` (únicamente ROLLBACK); no confundirlo con esa reversa.

La sesión de Supabase, el catálogo remoto exacto y una ejecución nativa PG15 nueva no se han comprobado en este incremento. No se afirma que el recorrido autenticado o el piloto estén aceptados hasta observarlos tras la corrección.

## Incidente del comparador r1 y corrección r2

El operador reportó WS_PRESERVATION_MISMATCH antes del COMMIT de051. El comparador r1 incluía proargdefaults como pg_node_tree sin reconstruirlo. PostgreSQL15 serializa posiciones :location reales; CREATE OR REPLACE vuelve a analizar el encabezado reconstruido y puede cambiar esas posiciones sin cambiar ningún default. PostgreSQL18, usado por el motor PGlite local, serializa -1 por defecto, por lo que la prueba inicial no representaba esta diferencia. El defecto del comparador está confirmado por revisión del código oficial y un modelo de serialización; el campo exacto que cambió en el intento remoto no se recibió y no se declara observado.

WS-COMPAT-r2 conserva todos los campos pg_proc y reemplaza únicamente la comparación de proargdefaults por su expresión reconstruida con pg_get_expr. Continúa verificando valores/defaults reales, número y tipos de argumentos, propietario, permisos, search_path, invoker, sourceHash y demás atributos. Un desacuerdo real sigue abortando; el error ahora devuelve changedMetadataFields, aclPreserved y sourceMatches sin volcar el código de funciones. No se ha quitado la guarda.

Secuencia manual tras el fallo: cleanup.sql → preflight.sql (readyToApply=true) → archivo051 actualizado, identificado WS-COMPAT-r2 en la primera línea → postflight.sql en otra ejecución (targetsOk=true). Reabrir el archivo local para copiar la revisión nueva; no reutilizar el contenido r1 ya pegado en el editor. Si el error persiste, conservar DETAIL y limpiar con cleanup.sql; no repetir a ciegas ni quitar la validación.

Fuentes primarias: [pg_proc15](https://www.postgresql.org/docs/15/catalog-pg-proc.html), [serialización15](https://github.com/postgres/postgres/blob/REL_15_STABLE/src/backend/nodes/outfuncs.c), [serialización18](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/nodes/outfuncs.c). El código15 escribe location; el18 usa -1 en nodeToString salvo petición explícita de ubicaciones. Esta explicación se limita al defecto identificado, sin inventar un ensayo nativo15.
