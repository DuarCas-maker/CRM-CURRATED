# Cierre de adjuntos y verificación de Composio

17 de noviembre de 2026, America/Bogota; capturas y ejecuciones después de medianoche UTC del 18. SDD STRICT. Estado vigente del candidato: `codex/simple-mail-ready-20261118`, base `544b8352634d9b07bcb0918df5866f37420515fa`. Sustituye los pendientes de adjuntos y la base b861486 de los registros anteriores; conserva sus evidencias históricas.

**Adjuntos resuelto; candidato local preparado. El cupo gratuito global de proxy Composio todavía no se puede acreditar con las vistas disponibles.** No se afirma que todo el alcance esté listo para publicar. No hubo cambios remotos.

## Causa y corrección

La prueba de adjuntos esperaba la separación seller/closer anterior a 055. El flujo vigente, aprobado en FR-02/AC-02 de Case Flow, considera responsable al closer asignado o al seller si no hay closer. Ese seller puede acceder al área necesaria para continuar el expediente. La fixture no tenía closer: debía mostrar sus cuatro adjuntos.

Se confirmó con consultas de permisos dentro de la fixture antes de corregir la expectativa. Solo cambió `tests/gmail-attachments.test.ts`; no se modificaron funciones, RLS ni migraciones para ampliar permisos. La prueba ahora comprueba los IDs exactos:

- Sin closer: el seller responsable puede gestionar el flujo y listar los cuatro adjuntos.
- Con closer asignado: el seller lista solo los tres de su área y no puede seleccionar archivos; el closer asignado ve los cuatro.
- Un usuario ajeno no lista ni selecciona. Se conservan selección explícita, dedupe, reintento de copia y preservación de archivos ya guardados.

La primera extensión de la fixture asignó closer sin `handed_off_at` y fue rechazada por el CHECK existente. Se corrigió la fixture estableciendo ambos campos, sin retirar ni relajar el constraint. Ese intento no tocó datos reales.

## Base y verificación

Main avanzó de b861486 a 544b835 durante esta tarea. Se revisó su delta de campañas y se creó un worktree nuevo; no hay solapamiento con los 42 archivos públicos del candidato, ni merge/reset/rebase sobre WIP. La captura productiva renovada devuelve **458 funciones, 144 relaciones y 1450 columnas**. Los 16 contratos seleccionados siguen coincidiendo y el guard de `command_v1` conserva su MD5 esperado. Fueron dos consultas administrativas READ ONLY con ROLLBACK; sin filas Auth ni contenido de buzones.

Adjuntos y Case Flow: **6/6** sobre 544b835. Regresión de **85 archivos: 539 correctas, cero fallos y seis omitidas** (545 resultados TAP, incluidos sus contenedores). Typegen, TypeScript y build webpack correctos. Resultados en `promotion-manifest.json`, `local-checks.json` y sus logs. La ejecución anterior sobre b861486 cerró con 537 correctas, cero fallos y seis omitidas; queda como antecedente.

Los 42 resultados focalizados y 14 nativos PostgreSQL 15.19 anteriores se conservan con procedencia explícita. El SQL, harness y fixtures nativos no cambiaron; el clúster quedó detenido. La regresión actual vuelve a incluir los tests de Conexiones. No se ejecutó un proveedor real, consentimiento, envío o prueba del stack Auth/PostgREST productivo completo.

## Lo que sí se verificó de Composio

Panel autenticado del workspace correcto: **Hobby, $0/mes**, 100000 tool calls al mes. Los $2 aparecen como créditos Instant; no se utilizaron ni incorporaron al presupuesto de correo. La [tarifa oficial](https://composio.dev/pricing/platform) publica **1000 proxy calls/mes** para Hobby y parada al alcanzar los límites sin sobrecargo. También distingue medidores y condiciones de transición de planes; no establece por sí sola el remanente de esta organización.

Se abrió Tool Logs y se aplicó el rango visible `Nov 1, 00:00 – Nov 17, 23:59` (hora de la interfaz). El resultado son **tres `GMAIL_PROXY_EXECUTE`**, todas exitosas; solo se conservaron fecha, estado, nombre y toolkit. No se abrieron detalles con payloads, buzones o credenciales. Esto mejora la evidencia: el uso observado es proxy, no una suposición sobre el nombre del medidor base.

El selector de Usage solo expone Tool calls, Errors, Sessions y Active users. Billing no ofrece saldo/reset de proxy. El resumen administrativo previo devuelve tres tool calls, sin ese saldo; la cifra organizacional de managed app calls es un medidor distinto. La [API documentada de uso](https://docs.composio.dev/reference/api-reference/organization) proporciona agregados, pero no acredita el periodo de facturación ni los derechos concretos de proxy del plan.

**No equivale a demostrar 997 proxies disponibles.** Quedan sin acreditar el periodo/reset aplicable y el saldo global del medidor compartido, incluyendo la relación con managed apps y las condiciones heredadas. No se inventó un saldo ni se sembró `simple_mail.included`. Composio permanece cerrado hasta tener esa evidencia; Gmail directo no depende de comprar créditos Composio.

La evidencia acotada está en `composio-quota-review.json`. Se dejó una [consulta concreta para el proveedor](composio-support-request.md), sin enviarla: pide los datos que faltan, sin upgrade ni compra. No se crearon claves ni se cambiaron límites. Esta es la única aclaración externa pendiente para cerrar la habilitación Composio.

## Publicación y reversa

Payload, hashes, base y SQL/reversa propuestos figuran en `promotion-manifest.json`; reproducir el empaquetado con `node docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/preflight/finalize-candidate.mjs`. Ese script es offline y exige checks verdes, contratos coincidentes y hashes esperados. Las observaciones previas conservan su fecha: no se regeneran para aparentar un runtime recién inspeccionado.

Ordinal 058 sigue solo propuesto, sin registro ni aplicación. En el momento de publicar: revalidar main/runtime/catálogo/ordinal; verificar backup inmediato; provisionar al worker las referencias de secreto/contexto existentes; desplegar SQL compatible y el mismo release web/worker con flags cerrados, y habilitar coordinadamente tras el smoke. Todo ello requiere la autorización concreta de publicación, y no forma parte de esta tarea de preparación.

No se reanuda ninguna campaña. La reversa de una instalación usada cierra el feature y conserva SQL aditivo/recibos; la reversa SQL se reserva a instalaciones sin uso. No se plantea retirar la protección de cupo para declarar esta entrega terminada.
