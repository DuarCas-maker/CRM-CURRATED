# Diseño

Dos funciones aditivas: `campaign_flow_v1.lead_states()` privada y `public.campaign_flow_leads(text,text,integer,integer)` autenticada, estable y SECURITY DEFINER con search_path vacío. Parte de los contactos de `campaign_control_v1.contacts` y reutiliza `campaign_prepared_leads` para disponibilidad. No altera funciones anteriores ni registros.

Prioridad para resolver solapamientos: envío confirmado → reserva de campaña → exclusión por baja/inválido → revisión (técnica/incierta/dudoso) → verificación en curso → pendiente → disponible → otra restricción. El historial de contacto y las reservas prevalecen sobre la clasificación de calidad del correo; las reglas reales de bloqueo/envío siguen vigentes. Un contacto previo registrado sin evidencia de envío Gmail se explica como restricción, sin inventar confirmación de envío.

La RPC devuelve conteos globales del mismo snapshot y una página de contactos filtrada. Cada contacto aparece una sola vez; un contacto con varios leads, enrollments o correos no multiplica conteos. La vista previa de disponibilidad conserva la autoridad del pool existente y la activación vuelve a validar como antes.

GET `/api/campaigns/flow?mode=leads&filter=…&search=…&page=…&size=…` añade la lectura al endpoint con sesión/no-store. Modos anteriores no cambian. Parámetros y filtros validados en HTTP y SQL. ControlLeads recibe un filtro opcional del funnel, conservando el lector anterior para las otras pantallas.

Tarjetas con nombres, conteos y descripciones; aria-pressed/foco visibles; última actualización silenciosa cada 15 s. Excepciones como botones compactos. Lista inferior identifica la etapa seleccionada y el motivo de cada contacto. Disponible conserva lote/crear campaña; los demás estados conservan confirmación de Bouncer únicamente para contactos que realmente admiten verificación/reintento.
