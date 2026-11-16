# Diseño y ADR-001

Se añade una proyección de lectura independiente, un endpoint GET autenticado y un componente exclusivo del drawer de Pipeline OS. Reutiliza permisos de dominio, reglas documentales y paginación con total exacto existentes. No altera el esquema, las acciones ni los estados persistidos.

`buildCaseProgress` recibe oportunidad, perfil y metadatos de documentos/análisis/procesos/evaluaciones/ofertas/eventos; devuelve cinco fases con puntos completos, pendientes, desconocidos o restringidos, acciones de navegación y contexto de proceso/cierre. No devuelve textos de análisis, correos, cuerpos, credenciales ni archivos. La API usa únicamente `requireUser`/RLS, nunca service role. Paginación ordenada por ID; errores y cambios de total invalidan la lectura. El seller no consulta tablas de lenders, procesos ni eventos privados.

El proceso es el activo con mayor número de secuencia, excluyendo el archivo sin clasificar; se advierte si hay varios activos. Sin proceso se conservan documentos/riesgo del expediente y los otros pasos quedan sin verificar. Los eventos se filtran por expediente/proceso y tipo, con fecha válida y evidencia de documento/correo. Los estados explícitos posteriores del proceso acreditan los hitos anteriores de contrato, sin inferir documentos/riesgo u oferta vigente ausente. La firma de solicitud nunca es fuente de contrato.

Ofertas con monto positivo, estado vigente y fecha no vencida; selección por `accepted`/`selected` o evidencia explícita del proceso. Una oferta ya seleccionada y respaldada por contrato del proceso se muestra como evidencia del cierre aunque venza después: el reloj no reabre un negocio contratado. Mayor monto no se selecciona automáticamente. Los requisitos del lender elegido prevalecen; sin selección se muestran requisitos abiertos del proceso. El fondeo exige estado **actual** `disbursed`, `actual_funded_amount > 0` y `funded_lender_id`, nunca el fondeo global de un caso anterior ni solo un evento antiguo de un proceso reabierto. Cierres `client_withdrew`/`funding_declined` tienen aviso terminal propio.

Las fases se verifican de forma independiente y se resalta el primer pendiente. Si existe un envío pero faltan documentos revisados, se muestran ambos hechos sin inventar una secuencia aprobada ni cambiar el stage global. Al seller se le abre por defecto el último paso visible cuando sus pendientes están completos; el contador indica que solo cuenta pasos visibles. Un cierre sin financiación abre su detalle de cierre y ofrece revisión, no desembolso.

El componente carga la proyección sin caché y aborta lecturas al cambiar de expediente. Un error muestra reintento, sin presentar ceros ficticios. Se vuelve a leer cuando cambia el workspace después de una acción existente. La demo usa una proyección local ficticia sin red. Los cinco pasos son una lista de botones nativos; despliegan el detalle y muestran el primer paso pendiente. Las acciones usan la confirmación de cambios sin guardar y enfocan el detalle existente. CSS acotado a Pipeline OS y tokens de su tema.

## Decisión

Proyección independiente en vez de deducir todo del stage global, del tablero paginado o de los primeros cien eventos de correo. Motivo: evita completar renovaciones con evidencia vieja y evita ausencia falsa por truncamiento. Coste: una lectura de metadatos adicional por expediente/actualización. Sin escrituras, suscripciones ni proveedores.

## Riesgos

Datos históricos sin asociación muestran “Sin proceso activo”, no éxito inferido. La base actual permite documentos/análisis compartidos por expediente: el panel lo explica y conserva esa política. No se modifica la comparación de ofertas del tablero ni se incorpora WIP de otros chats. Las lecturas RLS no son una transacción entre tablas; cambios de total/duplicados se rechazan y un cambio simultáneo de contenido requerirá actualizar, igual que otras vistas del CRM.
