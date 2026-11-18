# Funnel de leads — STRICT, implementación

El usuario confirma seis tarjetas: Total de leads → Por verificar → Verificando → Disponibles para campaña → En campaña → Ya contactados. Debajo, Necesitan revisión / Excluidos del envío / Otras restricciones. Conserva la usabilidad propuesta: filtros en la misma pantalla, estados exclusivos, selección por lotes y confirmación de créditos. Autorización integral de implementación/publicación del módulo vigente; no se solicitan permisos por archivo. STRICT por incorporar lectura SQL autenticada sobre datos existentes.

- FR-01 / AC-01: seis tarjetas en ese orden, sin tarjeta Válidos. Disponibles en verde. Los tres filtros de excepción aparecen en una línea compacta.
- FR-02 / AC-02: cada contacto visible tiene un único estado. Total = suma de los ocho estados (cinco principales sin Total y tres excepciones). Por verificar excluye las solicitudes en curso.
- FR-03 / AC-03: cada tarjeta y excepción filtra la lista sin navegar. Conteos globales, resultado de búsqueda/página separado, motivos comprensibles por contacto. Cola/proceso sin selección verificable; selección de lotes 20/50/100 intacta en disponibles.
- FR-04 / AC-04: Ya contactados exige un envío real confirmado por Gmail; no basta un outbox queued/sending/uncertain ni un envío de prueba. En campaña incluye reservas activas/pausadas todavía sin envío confirmado.
- FR-05 / AC-05: roles/MFA y visibilidad existentes, sin claves de servicio. Funciones nuevas solo de lectura, sin tocar envío, elegibilidad, worker, asignación, cuotas o proveedor. Reversa elimina únicamente las dos funciones nuevas.
- FR-06 / AC-06: móvil 360, tableta 768, escritorio; teclado, selección, estados vacío/carga/error y confirmación Bouncer comprobados con datos ficticios, cero llamadas de proveedor.

Las rondas anteriores y esta respuesta cierran la organización y usabilidad. No se activa ninguna campaña ni se verifican correos reales durante pruebas o publicación.
