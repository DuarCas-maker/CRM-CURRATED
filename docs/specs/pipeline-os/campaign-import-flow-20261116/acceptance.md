# Aceptación

1. CI-AC01 / FR01: abrir Campañas muestra crear y gestionar; un seller no recibe controles de escritura.
2. CI-AC02 / FR02: importar con el asistente existente entrega el ID; volver/retomar conserva el lote y no vuelve a subir el archivo.
3. CI-AC03 / FR03: filas repetidas cuentan un contacto; válidos previos se reutilizan, pendientes se confirman y encolan una sola vez por clave. No se encolan técnicos, inciertos, bajas o ajenos. Cantidad obsoleta se rechaza.
4. CI-AC04 / FR04: dos lotes y contactos globales adicionales; tanto vista previa como snapshot incluyen solo el lote seleccionado. Una selección forjada de otro lote se rechaza. El límite no recorta silenciosamente.
5. CI-AC05 / FR05: verificación o guardado no crean enrollments/outbox. Activación manual produce inscripciones solo del snapshot elegible y conserva idempotencia/controles existentes.
6. CI-AC06 / FR06: seguimiento reutiliza aceptación Gmail y respuestas confirmadas existentes. UI no fabrica métricas en demo.
7. CI-AC07: anon, aal1, roles sin administración y remitentes no autorizados son rechazados. Ausencia de migración devuelve503 sin fallback a audiencia global.
8. CI-AC08: aplicar/revertir SQL local conserva campañas, lotes, historial y filas existentes. UI revisada en360/768/1280 y estados vacío/carga/error con backend ficticio.
