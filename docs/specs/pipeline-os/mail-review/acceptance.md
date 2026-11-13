# Escenarios

1. Dado mensaje entrante asociado, al analizar sin aprobar, solo existe propuesta; cero ofertas, requisitos o tareas nuevos.
2. Dada oferta revisada, al aprobar se crean exactamente una oferta, tarea y update con el mismo mensaje/proceso; recargar/repetir conserva IDs.
3. Dado requisito revisado, se registra requisito y seguimiento sin aprobar documentos ni aceptar ofertas.
4. Dado mensaje sin proceso/evaluación, se exige elegir entidades existentes; un hilo sin expediente continúa en Pendientes de Conversaciones.
5. Dado importe ausente, requisito vacío, responsable ajeno, fuente cambiada o revisión antigua, se rechaza sin escrituras parciales.
6. Dado seller, ajeno, inactivo, anónimo o MFA ausente, no lee ni aprueba datos comerciales de lenders.
7. Dado proveedor inválido/timeout, se conserva error sin reenvío automático; un reintento explícito usa revisión vigente y un intento distinto.
8. Dada demo, no se llama IA ni Gmail; el recorrido usa fuente ficticia claramente identificada.
