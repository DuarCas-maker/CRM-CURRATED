# Aceptación S02-I01

31/10/2026 · **AC01–10 cubiertos offline por33/33 pruebas nuevas y comprobaciones de alcance.** [Spec](spec.md), [tareas](tasks.md), [evidencia y límites](verification.md). La última columna identifica la cobertura exigida y realizada; no implica aceptación de proveedor o cuenta real.

| AC | Dado / cuando / entonces | FR | Evidencia nueva necesaria |
|---|---|---|---|
| S02I01-AC01 | Dado el producto vigente, al completar I01 la fachada mantiene firma/exports y solo usa directo; ninguna variable/binding activa Composio en web o worker. | FR01/07 | Grafo de imports y prueba de selección, sin servicios. |
| S02I01-AC02 | Dadas respuestas representativas y requests actuales, al delegar HTTP directo se conservan JSON, id/threadId, headers legítimos, MIME/raw y errores/costos, sin cambios en llamadores. | FR01/02/06 | Fixtures de frontera; no reensayo manual de correo. |
| S02I01-AC03 | Dado binding ficticio exacto, al ejecutar proxy el único intento usa host, conexión y userId correctos; outer200 con status/data interior inválidos no es éxito. | FR02/04 | Captura de request ficticio y validación por recurso. |
| S02I01-AC04 | Dado un permiso revocado durante espera/reserva, al correr callback este veta antes de HTTP; en camino válido se reserva y llama al hook una sola vez en el orden previsto. | FR03/08 | Eventos ordenados en dependencias inyectadas; sin repetir matriz S01. |
| S02I01-AC05 | Dado un adaptador distinto, al preparar el despacho no cambia el ID de cuenta ni se reinician cuotas; un proyecto de binding desconocido impide habilitación futura. | FR03 | Contrato y prueba de composición de frontera, sin esquema nuevo. |
| S02I01-AC06 | Dados ID malformado, binding no verificado, ruta absoluta/ambigua, método no permitido o redirección, al solicitar ejecución se rechaza sin enviar a un destino alternativo ni exponer secreto. | FR04/07 | Negativas de request/destino y pruebas de redacción. |
| S02I01-AC07 | Dados outer401/429/5xx y Gmail interior401/403/429, al clasificar se distinguen proveedor/Google, origen de espera e incertidumbre; outer401 no revoca masivamente buzones. | FR05 | Fixtures separados por capa; sin respuesta libre en error. |
| S02I01-AC08 | Dada pérdida de respuesta después de iniciar POST, al fallar no hay retry/fallback ni otro Message-ID; el error permite que el caller conserve resultado incierto. | FR05 | Un único intento contabilizado incluso con timeout/envelope truncado. |
| S02I01-AC09 | Dados cursor, hilo, firma y adjunto ya construidos por los llamadores, al usar proxy regresan los mismos IDs/datos; requests cercanos a tamaños admitidos no se recortan silenciosamente. | FR06 | Fixtures contractuales nuevos y frontera de MIME/base64/tamaño. |
| S02I01-AC10 | Dado el manifiesto finito y la base revisada, al cerrar el incremento no hay cambios S01/S00/DB/dependencias/credenciales, ni red al importar módulos; se documentan pendientes de integración. | FR07/08 | Hashes/alcance, typecheck y revisión del delta; pruebas aceptadas conservadas. |

La cobertura nueva se concentra en el cambio de frontera, capas de error y composición de guardas. No ejecutar S00, volver a revocar cuentas, verificar más leads, enviar correos/PDF o repetir aceptación manual ya confirmada para demostrar estos AC. Las pruebas futuras de activación medirán solo los riesgos introducidos por el corte y tendrán un permiso/presupuesto propios.
