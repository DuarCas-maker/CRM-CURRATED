# MR-FINAL-r1 — diseño y tareas

MR-AUTH-r1 modifica únicamente el generador: overlay explícito para dos expresiones de inactividad y dos helpers privados UTC, más guarda del tipo Auth. [ADR/FR/AC/T de la corrección](auth-session-bugfix.md). Las fuentes F2 no se editan. Esta revisión amplía la transformación descrita abajo; no solo elimina wrappers.

MR-ADR01: empaquetar en orden T-002, WC-I01, R06-I01, R06-I02, R06-I03 y T-009. Eliminar únicamente wrappers de host/fixture en la copia generada; conservar los checks funcionales/source-pinned y todas las fuentes originales. Sustituir el wrapper por contrato/contexto/cola/locks del instalador final. Sin CREATE IF NOT EXISTS para ocultar aplicación parcial. No publicar descriptor ni crear registros de operación durante DDL.

Contrato lógico generado con base049 y composición exacta en memoria. Captura objetos cambiados y precondiciones estructurales; conserva el resto del catálogo observado dentro de la transacción. No OIDs persistidos, datos de clientes ni cuerpos en resultados. sourceHash usa LF normalizado; columnas, ACL, índices, constraints y triggers siguen comparados. La comparación de deparser es estricta y requiere ensayo PG15 físico; no inventar equivalencia por un hash observado diferente. Las vistas anteriores no se reescriben.

MR-ADR02: el error confirmado de publicación CSP se corrige agregando únicamente https://connect.composio.dev a form-action, conservando Google y los demás headers. La URL sigue validada por el motor; no wildcard ni connect-src nuevo. Esto permite el303 del formulario, no activa la feature ni el transporte.

MR-T01 / MR01–03: generador determinista, contrato y catálogo, preflight/install/postflight y reserva050 comprobada en el árbol local. MR-T02 / MR04: ensayo del archivo final con rollback y negativos de actor, catálogo, cola y privilegios, con red bloqueada. MR-T03 / MR05: CSP y regresión, inventario/snapshot reproducible de fuentes, runbook y variables por recurso. MR-T04 / MR01–05: sellado/preservación/hash y evidencia; publicación/PG15 real/piloto permanecen separados.

Reversa: antes del COMMIT, ROLLBACK atómico. Después de publicar, apagar alta/routing y pausar worker, conciliar trabajo y corregir hacia delante conservando esquemas/recibos. No DROP de historial o vuelta automática a un binario antiguo que eluda guardas. No se ofrece un rollback destructivo de datos como parte de esta preparación.
