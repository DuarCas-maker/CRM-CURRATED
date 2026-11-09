# Diseño y decisión CW-ADR01

El coordinador incorpora una instantánea pública T-002 y conserva el recibo de origen. La SQL local mantiene la guarda de propietario/base/loopback; no se numera ni publica como migración remota. La única diferencia prevista en su copia es la corrección FR04, con hash original y resultante diferenciados. No se altera el checkout del chat F2.

T-002 usa composio_connect y el puente C1; WC-I01 usa worker_pilot y la admisión B2. La prueba de composición añade auth.sessions ficticia y adapta exclusivamente la guarda de host en memoria, exige marcador propio y deja la SQL de disco protegida. No modifica funciones existentes ni implica soporte de HTTP/OAuth reales.

FR04: el SELECT previo a INSERT no serializa publicaciones concurrentes. El ON CONFLICT debe aceptar UPDATE solo cuando la generación almacenada sea menor; si ninguna fila cambia se devuelve CONNECT_STALE. Instrumentación temporal de la función, solo en memoria, intercala una publicación superior entre comprobación y escritura y restaura la definición al terminar. Es una reproducción determinista del intervalo vulnerable, no dos conexiones PostgreSQL físicas. Se descartó el primer intento con un trigger porque PostgreSQL impedía modificar dos veces la fila dentro del mismo INSERT; ese error no reproducía la carrera buscada.

Rollout: revisión local y posteriores T-003/UI/R06, QA combinada y migración definitiva antes de publicación. Rollback de este incremento: excluir la selección de archivos nuevos, conservando el WIP y el checkout F2; no ejecutar su rollback SQL en producción. No se reejecuta 049.
