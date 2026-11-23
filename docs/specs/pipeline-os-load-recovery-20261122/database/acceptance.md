# Aceptación STRICT

AC-004a: Dado cada rol activo AAL2, al consultar el mismo snapshot antes/después, el conjunto completo de15 columnas es idéntico, incluida redacción de subject/submission/process/recipient y can_reply.

AC-004b: Dado seller/closer ajeno, actor inactivo, AAL1 o anon, no se amplía acceso; conversaciones sin mensajes dependen de su área y casos no calificados siguen invisibles.

AC-004c: Dadas conversaciones mixtas y empates de fecha, el mensaje elegido sigue siendo el último autorizado por sent_at DESC,id DESC; uno oculto más reciente no altera metadata visible.

AC-005: Dado catálogo esperado, apply cambia solo fuente; rollback restaura la fuente y contrato original y reapply funciona. Fuente inesperada aborta sin escritura.

AC-006: Dada autorización remota nueva y respaldo verificado, migración transaccional y checks reales correctos; sin esa autorización solo preparar/pruebas locales. Si sigue57014, mantener recuperación pendiente.
