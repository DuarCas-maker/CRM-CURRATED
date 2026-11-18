# Diseño

Reutilizar importador, cola Bouncer, candidatos de primer contacto, renderer, outbox e idempotencia existentes. Nuevo contrato autenticado para pool y lanzamiento por lote. La identidad y marca se preparan mediante el contrato instalado; jamás se acepta contexto arbitrario del cliente.

La campaña nueva conserva una sola cuenta y congela primer mensaje y cuatro pasos. Crear y activar la selección exacta por las funciones de primer contacto existentes, dentro de una transacción; preservar asesores y finalizar los pasos dentro de la misma transacción permitida por el guard de marca. Una marca de versión identifica este flujo; no modificar secuencias históricas.

El calendario calcula días civiles en la zona de la campaña, desplazando domingo. Un trigger de avance usa la confirmación real en outbox. El límite final de despacho vuelve a comprobar domingo, respuesta, baja y caso. Se preservan admisión de marca, cupo de cuenta, límite global e incertidumbre.

Consentimiento de importación persistido por lote, actor y máximo; barrera idempotente para cada contacto. El registro y los chunks reutilizan el proceso actual. Solo pendientes sin verificación previa entran automáticamente; los inciertos y errores requieren el panel de revisión existente.

Interfaz: dos pestañas principales, «Leads» y «Campañas». Pool con filtros y selección de página de 20/50/100; configuración inline con cuenta, plantilla, calendario y vista previa. Preparación y Bouncer en el mismo espacio. Resultados e histórico reutilizan el detalle existente y añaden secuencia.

Cambios aditivos, funciones SECURITY DEFINER con search_path vacío y grants mínimos; RLS en tablas públicas. La reversa no elimina historial ni mensajes. Los cambios de F1, incluyendo migraciones 055–057, se conservan y concilian antes de promover.

La atribución de respuestas considera los cinco mensajes confirmados, pues Gmail puede colocar asuntos distintos en hilos físicos diferentes. Se conserva la misma prueba de destinatario, cuenta, tiempo, referencias RFC y marca; el detalle abre la conversación de la última respuesta. Los wrappers delegan sin cambios las campañas históricas. La protección final también vuelve a comprobar fecha/paso, evitando enviar antes de una reprogramación.

Los registros internos que la validación crea para leads todavía sin contacto se mantienen en el pool. La lectura de Pipeline excluye preparaciones intactas; conserva casos con contacto, documentos, evidencia de cliente o etapas avanzadas. El estado de campaña se proyecta como Sin respuesta / En proceso / Incidencia: rebote, sin completar documentos automáticamente.
