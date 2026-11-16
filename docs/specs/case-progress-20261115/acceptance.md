# Aceptación

1. Dado cualquier expediente de Pipeline OS, al abrirlo el seguimiento precede las herramientas; cambiar paso no modifica datos.
2. Dada una aplicación firmada sin archivo aprobado o cuatro extractos duplicados, Documentos sigue pendiente. Un informe de análisis no cuenta como documento fuente.
3. Dado un borrador de UW, una revisión incompleta o `is_current=false`, Riesgo sigue pendiente. Solo revisión vigente y entrega al closer lo completan.
4. Dado un proceso antiguo con oferta/contrato/fondeo y una renovación activa, solo los registros de la renovación completan sus tres fases finales. Sin proceso no se atribuye evidencia legado.
5. Dado un envío draft/queued/uncertain, Lenders no queda completo. Un envío registrado en estado confirmado sí cuenta.
6. Dadas ofertas vencidas, descartadas o de otro proceso, no completan la negociación. La oferta mayor no prueba selección; `selected`/`accepted` y selección explícita sí.
7. Dada solo `application_signed`, contrato sigue pendiente. Estado/evento explícito de contrato acredita su hito; fondeo sin monto/lender o de otro proceso no completa desembolso.
8. Dado retiro o rechazo terminal, se muestra cierre sin financiación, no éxito ni una orden de enviar más correos.
9. Dado un seller, no aparecen conteos, selección, contratos o monto privados. Dado usuario sin acceso, la API rechaza la lectura antes de consultar metadatos.
10. Dada paginación REST reducida, se leen todas las páginas; total cambiante, duplicados o fallo de lectura muestran error/reintento. Cambio de expediente aborta la respuesta vieja.
11. Dado un pendiente, su acción abre la sección correspondiente y respeta formularios sin guardar; el teclado permite operar sin mouse en 360/768/1280.
