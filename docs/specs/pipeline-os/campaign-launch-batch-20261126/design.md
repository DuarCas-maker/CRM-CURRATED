# Diseño

Materializar una vez la audiencia por comprobación SQL y consultar ese conjunto para todas las identidades seleccionadas. Mantener las comprobaciones dentro de la transacción y después de los mismos locks; no cachear entre solicitudes. Corregir los dos puntos correlacionados: campaign_flow_launch y crm_command_before_brand_b1. El segundo también cubre el alta mediante el control anterior.

El primer ensayo corregido avanzó hasta la activación y encontró otra repetición: campaign_audience se evaluaba tres veces (faltantes, existencia y creación de inscripciones). En la misma segunda función se conserva una sola instantánea local JSON de esa audiencia, tomada después del lock de contactos, para esas tres comprobaciones. Se mantienen motivos, mensajes, selección y manejo de inscripciones pausadas.

El segundo ensayo confirmó que incluso las tres consultas únicas seguían recorriendo el pool completo y agotaban 8 s con el cuerpo financiero. Se añade un lector privado derivado exactamente del cuerpo actual de campaign_prepared_leads, con filtro de IDs antes de calcular campos, permisos y motivos; incorpora la misma comprobación de rol/remitente de first_contact_candidates. Solo las comprobaciones de creación/programación lo utilizan, con IDs ya bloqueados. El lector original no se modifica. Schema y función privados sin acceso para anon/authenticated/service_role; se prueba igualdad de resultados con el lector original para selecciones mixtas.

Aplicar reemplazos exactos sobre las definiciones actuales; abortar si no coincide cada fragmento una sola vez. Guardar definiciones antes/después para reversa y probar la composición con funding/owner. No cambiar firma, propietario, grants, security definer, search_path ni funciones externas de verificación.

El servidor traduce SQLSTATE 57014 a 503 con mensaje de consulta cancelada, conservando el request_key y el manejo de errores de datos. No ampliar statement_timeout ni reducir tamaño del lote para ocultar el fallo.
