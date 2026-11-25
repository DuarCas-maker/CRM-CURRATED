# Diseño

Extender contactos con ingreso/procedencia, plantillas y campañas con modelo JSON versionado, e inscripciones con ingreso congelado. Controles y auditoría SQL, sin ampliar roles. La disponibilidad de destinatarios conserva gates de marca, unicidad, Bouncer, rebotes, bajas, permisos y datos requeridos.

El renderizador limitado mantiene plain/markdown; se agregan presentación de tarjeta y tabla de opciones sin permitir HTML arbitrario. La UI edita los tres parámetros y previsualiza con datos ficticios. Remitente proviene de la cuenta seleccionada; la firma sigue el flujo existente de Gmail.

Importación: detección opcional de Monthly Income, parser de USD estricto, actualización por correo exacto en transacciones acotadas. Recuperación: leer el archivo existente en memoria, agrupar por correo, preparar informe agregado, respaldar y aplicar solo coincidencias verificadas; datos de clientes fuera de logs y Git.

Cambios SQL aditivos y revisiones guardadas con hashes del catálogo; ensayos locales con roles/MFA, compatibilidad, snapshots y reversa. El rollback no borra ingresos ni evidencia recuperada y no reactiva campañas.

La entrada de Pipeline OS carga el workspace autenticado; el tablero de historial se consulta aparte cuando una vista lo necesita. Campañas y sus refrescos no esperan ese tablero. Un tablero ausente conserva un estado no disponible y contadores —, sin presentar ceros ficticios. Esto evita que un timeout de correo cierre el módulo de campañas.
