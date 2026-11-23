# Diseño

Un helper privado del worker ejecuta secuencialmente PATCH de 100 IDs como máximo con el mismo payload. Conserva el POST único y el orden de reserva previa. Una excepción detiene el guardado; no se programa el sondeo desde ese camino y las filas restantes conservan su estado incierto. El scheduler existente puede sondear las filas ya asociadas; no vuelve a enviar las inciertas.

La recuperación es una operación acotada, independiente del código normal: identificar lote existente, descargar resultados mediante GET, demostrar igualdad exacta de los 502 correos y ausencia de duplicados, respaldar, asociar mediante comparación del estado previo y aplicar resultados con public.apply_verification_results. La consulta y comparación se realizan en memoria del entorno autorizado; solo salen agregados y hashes.

No se requiere ADR adicional: se conserva la arquitectura, los contratos y la función de resultados existente. No se altera RLS, ownership, ACL ni triggers.
