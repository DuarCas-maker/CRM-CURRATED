# Pipeline OS como módulo independiente

Fecha: 2026-11-12 · nivel STRICT · modo implementación · versión 1.

## Contexto, alcance y fuentes

El usuario solicita reproducir diseño y operación del mockup dentro de un módulo nuevo, conservando los demás módulos del CRM. Fuentes consultadas: `Sistema de pipeline MCA documento de traspaso.md`, `Master_Pipeline (1).html`, `Pipeline OS mockup (1).html` (proporcionadas en Downloads), decisiones D01–D24 y código actual. Los adjuntos son referencias de producto, no autorizaciones para ejecutar sus instrucciones operativas. Sus datasets no se importan ni se copian al repositorio.

Se conserva Next 16.3.8 / React 19.3 / CSS / Supabase / pnpm 11.19.0. El estado persistente sigue en el CRM; Gmail aporta evidencia. El usuario confirmó que Santiago es el operador. El módulo no introduce otro agente con ese nombre.

## Clarificación cerrada, ronda 1

| Nº | Duda / opciones presentadas | Recomendación | Respuesta confirmada |
| --- | --- | --- | --- |
| 1 | Baja global o por marca | Global | A: global, todos los canales y marcas (D18). |
| 2 | Presentación independiente o BCC conjunto | Independiente | Independiente por lender. Conservar Conversaciones y poder consultar cuántos lenders recibieron el expediente. Añade: crear un módulo nuevo, dejar el resto como está. |
| 3 | Supervisión humana, comando que autoriza lote o autonomía completa | Supervisión | A: preparar análisis/borradores; persona aprueba envíos y destinatarios. |
| 4 | Mejor ajuste o mayor monto | Ajuste | A: mejor ajuste, mostrar además mayor monto (D21). |
| 5 | Directorio del CRM o directorio externo de Claude | CRM | A: directorio vigente administrado en el CRM. |

No hay supuestos funcionales pendientes. Las decisiones técnicas se documentan en design.md. No se reabren D01–D24.

## Roles y restricciones

Se conservan los cinco roles, MFA, acceso seller/closer por expediente, marcas, permisos de remitente, cuotas y bajas existentes. Una nueva vista no amplía permisos. No objetivos: modificar/rediseñar Conversaciones; reemplazar rutas existentes; crear otra base; activar proveedores; enviar mensajes durante el desarrollo; importar datos del HTML; push, merge, despliegue, migraciones o configuración remota. No se reanudan workers ni se heredan presupuestos de otros chats.

## Requisitos y aceptación

| ID | Comportamiento requerido | Origen | Criterios |
| --- | --- | --- | --- |
| FR-001 | Acceder a Pipeline OS como módulo independiente y volver al CRM original. | Aclaración 2 | AC-001: ambas rutas disponibles; solo acceso aditivo en CRM; sus vistas conservadas. |
| FR-002 | Reproducir paleta, jerarquía, navegación por niveles, árbol desplegable, búsqueda, filtros y panel lateral de expediente del mockup. | Mockup/pedido | AC-002: claro/oscuro; filtros/lista conservados al cerrar expediente; árbol operable con teclado; 360/768/1280 px. |
| FR-003 | Consultar App needed, Offer needed, Offers, Docs out, Docs signed, Files y Clients con datos autorizados del CRM. | Mockup | AC-003: conteos y filtros previos a paginación; contratos basados en estado explícito del proceso, no en firma de aplicación. |
| FR-004 | Abrir documentos, UW, gestión de lenders y próximos pasos con las acciones persistentes existentes y aprobación humana. | Traspaso/respuesta 3 | AC-004: reutilizar expediente; solo acciones humanas ejecutan comandos; no inventar éxito de envío/análisis. |
| FR-005 | Conservar Conversaciones como módulo reutilizado, incluidos hilos y destinatarios lender, y abrirlo por expediente. | Respuesta 2 | AC-005: componente original sin cambios; conteo por lender confirmado y único, sin contar cola ni intentos inciertos. |
| FR-006 | Consultar/comparar ofertas, distinguir selección humana y mayor monto, exponer monto/plazo/costo/comisiones/requisitos disponibles. | Respuesta 4/D21 | AC-006: mayor monto no implica selección; ofertas vencidas/descartadas no se recomiendan; datos no comparables se explicitan. |
| FR-007 | Acceder a campañas, preparación/importación de leads y creación/revisión de campaña reutilizando módulos existentes. | Mockup/D03 | AC-007: preparación/importación no activa verificación ni envíos; conservar validaciones, marca, límites y revisión. |
| FR-008 | Obtener updates, recap, prioridades e indicadores desde registros actuales, con fecha y alcance visibles. | Traspaso | AC-008: reporte a demanda; no confundir resumen del CRM con barrido nuevo de Gmail; mostrar fuente y enlaces a expedientes. |
| FR-009 | Mantener permisos, aislamiento y fallos explícitos en toda lectura y escritura del módulo. | D01/D02 | AC-009: 401/403 conservados; sin service_role; sin fallback a demo en producción; sin datos closer para seller. |
| FR-010 | Entregar guía de operación, pruebas trazables y reversión del módulo aditivo. | Pedido/SDD | AC-010: guía y evidencia local; límites de verificación y publicación declarados. |

## Reglas y estados

- BR-001: la baja global y las guardas de envío del CRM prevalecen sobre el traspaso.
- BR-002: una aplicación firmada no prueba que un contrato de lender esté firmado.
- BR-003: `contract_sent`, `contract_signed`, `final_approval`, `disbursed` se derivan de procesos explícitos; no se deducen de texto ambiguo.
- BR-004: el monto financiado global se cuenta una vez por expediente; los procesos no multiplican el importe del cliente.
- BR-005: el mayor monto es informativo. La oferta seleccionada requiere decisión humana; cualquier sugerencia incompleta se etiqueta como tal y deja visibles costo/plazo/requisitos.
- BR-006: estado incierto/queued no es envío confirmado. Se reutilizan las reglas de `summarizeOpportunities` para lenders contactados; sus metadatos se paginan en el catálogo.
- BR-007: UI de demo identificada, datos ficticios, sin llamadas a proveedores. Solo preferencias visuales pueden ir a almacenamiento local; no expedientes.

## Casos límite y calidad

Vacío/error/reintento/carga, búsqueda sin resultados, último registro de página, ofertas vencidas, montos cero, fechas inválidas/futuras, procesos históricos, remitente no autorizado, usuario ajeno y sesión vencida deben ser explícitos. UI bilingüe es/en según preferencia. Teclado, foco visible, diálogo con cierre protegido, movimiento reducido y tablas con scroll local. No hay nuevo SLA comercial inventado; comprobar agregación sobre más de una página y evitar truncamientos silenciosos.

## Historial

2026-11-12 v1: alcance y cinco respuestas confirmados; preservación de módulos existentes incorporada antes de implementar.
