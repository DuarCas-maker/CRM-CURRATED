# Escenarios de aceptación

- AC-001: Given el CRM existente, When abro Pipeline OS, Then aparece una ruta nueva y puedo volver sin reemplazar las pantallas actuales.
- AC-002: Given búsqueda/filtro y lista, When abro/cierro expediente, Then conservo contexto; árbol, niveles y tema se controlan con teclado y a 360/768/1280 px.
- AC-003: Given más de una página y contratos de procesos históricos, When filtro, Then cuento antes de paginar y un contrato antiguo no sustituye al proceso vigente. Una aplicación firmada no cuenta como contrato firmado.
- AC-004: Given documentación y UW, When abro el análisis, Then el flujo existente requiere revisión/aprobación; abrir una vista no inicia ni envía nada.
- AC-005: Given 40 lenders únicos con envío confirmado y otros queued/uncertain, When consulto el expediente, Then cuenta 40 y abre Conversaciones original con sus hilos.
- AC-006: Given oferta aceptada de menor monto y una mayor, When comparo, Then distingo selección humana/mayor monto. Si está vencida/rechazada, no la sugiero como vigente.
- AC-007: Given una importación o nueva campaña, When preparo la audiencia, Then no se activa verificación ni envío sin las confirmaciones existentes.
- AC-008: Given registros actuales, When pido updates/recap, Then veo fecha, ventana, fuente y próximos pasos; no se afirma haber hecho un barrido nuevo de Gmail.
- AC-009: Given seller/closer/ajeno/anon y MFA insuficiente, When solicito datos, Then se mantienen los límites del CRM; error no produce datos ficticios. Un fallo parcial no produce conteos aparentados como completos.
- AC-010: Given el cambio terminado localmente, Then la guía explica operaciones y limitaciones y verification.md enumera solo checks observados.
