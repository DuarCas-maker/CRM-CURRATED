# Diseño del módulo independiente

2026-11-12 · STRICT · spec v1.

## Arquitectura actual y cambio

`CRM` contiene navegación y acciones; `loadWorkspace` aplica sesión/MFA/RLS, pagina oportunidades y carga contexto. `OpportunityDetail`, `ConversationsWorkspace`, `CampaignCenterWorkspace`, `CampaignComposer`, `CampaignReview` e `ImportWizard` ya implementan los flujos persistentes. No se cambia su implementación.

Nueva ruta `/pipeline-os`, demo `/pipeline-os/demo`, componente cliente y CSS limitado a `.pipeline-os`; único enlace aditivo en navegación original. Lectura nueva autenticada `/api/pipeline-os`: catálogo operacional completo bajo RLS, proyecciones mínimas, paginación estable de fuentes y filas de salida. Contexto de expediente cargado mediante `/api/workspace?case=...`; las listas permanecen montadas al abrirlo. Conversaciones se monta sin modificar su código.

## Componentes y trazabilidad

| Componente | Responsabilidad | FR |
| --- | --- | --- |
| `src/lib/pipeline-os/module.ts` | Proyección pura, grupos, filtros, ofertas, prioridades, métricas | 003/006/008/009 |
| `src/lib/server/pipeline-os-module.ts` | Lectura completa por páginas con cliente autenticado y redacción seller/closer | 003/005/009 |
| `src/app/api/pipeline-os/route.ts` | GET autenticado, respuestas sin caché | 003/009 |
| `src/app/pipeline-os/**` | Entrada real/demo, carga/error | 001/009 |
| `src/components/pipeline-os/**` | Diseño y navegación aislados; reutilización de módulos | 002/004/005/007/008 |

## Datos, contratos y autorización

No hay tablas, índices, constraints, RLS ni migraciones nuevas: se usan las fuentes existentes. El catálogo usa `opportunity_workspace`, tareas, documentos, ofertas, submissions y procesos ya autorizados. RLS y una segunda comprobación `canSeeOpportunity/canSeeArea` evitan ampliar visibilidad. Los estados closer de procesos y ofertas no salen al seller. No se lee con service_role ni se consultan credenciales/env durante el trabajo.

GET `/api/pipeline-os?q=&owner=&group=&page=` devuelve fecha, conteos exactos del ámbito filtrado, resumen por responsable, filas paginadas y `total/hasMore`. Valida longitudes/enums/página; 400 inválido, 401 sin sesión, 403 MFA/acceso, 5xx dependencia. El servidor limita salida a 50 filas y pagina internamente cada fuente sin asumir límite de PostgREST. No acepta IDs de otra sesión como autorización. La lectura no escribe.

Se conserva POST `/api/actions` con `kind/payload/idempotency_key`, autorización y validación existentes. La envoltura cliente conserva la clave ante error/reintento; separa éxito de comando y error posterior de refresco para evitar repetir un envío. Las acciones de componentes especializados siguen sus propios contratos. No hay nuevo endpoint de envío.

## Navegación, estados y diseño visual

Árbol desplegable inicialmente cerrado, inicio conservado y niveles añadidos debajo; cambiar un hermano descarta niveles posteriores. Historial UI solo conserva tema/árbol, nunca datos financieros. Panel de expediente con foco y cierre protegido reutilizando diálogo existente; Conserva búsqueda/filtros/lista. Cada cambio de filtro reinicia la página; abortar lecturas obsoletas. Actualización manual no genera tráfico de Gmail ni ejecuta el worker.

Tokens extraídos del HTML: fondo #f5f3ee, panel #fff, texto #1d1c1a, acento #1e5a46, borde #e5e1d7; serif Instrument Serif, sans Instrument Sans con fallback local; tema oscuro #141412/#1d1c1a/#5fb393. Fuentes: usar archivos disponibles o descarga pública de tipografías, sin copiar datasets ni fuente base64 del HTML. Lucide ya instalado sustituye glifos Tabler sin dependencia adicional. Contenedores prefijados para no afectar CSS global. Componentes reutilizados conservan su estructura/acciones.

## Ofertas e indicadores

Oferta seleccionada: la aceptada explícitamente por una persona. Mayor monto: máximo independiente entre ofertas vigentes. Se presentan términos/costo/frecuencia/comisiones y próximos requisitos; cuando no existe selección, se muestra comparación pendiente, evitando inventar un ranking multidimensional a partir de texto no comparable. Una sugerencia por proximidad al importe se identifica como provisional y nunca selecciona/envía. Fondeos no se duplican por lender/proceso.

Updates deriva registros del CRM con fecha/ventana seleccionable; enlaza ofertas, contratos explícitos, requisitos, documentos y tareas. Indica que recepción y clasificación dependen de la sincronización existente. No se presenta como ejecución de Composio ni como un barrido exhaustivo nuevo de los 18 buzones.

## Integraciones, consistencia y observabilidad

No hay integraciones nuevas ni cambio de proveedores. Los componentes actuales conservan colas, cuotas, marcas, bajas, revisiones y conciliación de incertidumbre. No hay reintento automático de comandos desde el módulo. Lecturas fallidas muestran error/reintento; no demo silenciosa. El catálogo es una observación de varias lecturas bajo RLS, no una transacción temporal: se muestra as-of y se permite refrescar. Un fallo descarta la observación incompleta.

## Calidad, riesgos, alternativas y entrega

Pruebas puras de grupos/evidencia/ofertas, paginación y permisos; integración con fixtures sintéticos; regresión de componentes y tipos/build. UI en 360/768/1280, teclado y estados. No se prometen latencias sin medir. Riesgo de volumen: proyecciones pequeñas y salida paginada; lectura completa puede ser costosa en grandes catálogos, se documenta y mide localmente. Riesgo de dependencia remota: demostrar con fixtures y declarar prueba real pendiente.

Alternativas: reescribir CRM (descartada por petición de conservarlo), copiar HTML con datos fijos (descartada por ausencia de persistencia), módulo aditivo que reutiliza backend/componentes (elegida, ADR-001). Rollout/rollback en rollout.md. Seguridad/migración de esquema: no aplica cambio de esquema; no se alteran políticas. No hay publicación autorizada en esta tarea.

## Desviaciones

- Se reutiliza `documentProgress` para mínimo de cinco documentos y deduplicación, en lugar de contar solo filas del checklist. No cambia reglas existentes.
- Se filtran ofertas por el proceso activo cuando existe; `process_id` se incluye en la proyección de submissions. Los envíos históricos conservan su conteo propio de expediente.
- Una renovación en proceso preparado/enviado/evaluación conserva la tarea activa aunque el expediente tenga fondeo anterior; no multiplica el importe registrado del cliente.
- El conteo de campañas usa una proyección completa de `campaign_workspace`, no las primeras 500 campañas del contexto del CRM.
- Los metadatos de conversaciones/mensajes se leen con el mismo paginador de conteo exacto, reutilizando `summarizeOpportunities`. Así el módulo no depende del límite fijo de 1000 del lector histórico compartido y no necesita editar ese lector.
- El panel usa `OpportunityDetail` completo (sin modo embedded), para conservar sus pestañas y gestión histórica. El enlace a Conversaciones respeta la protección de cambios.
- La prueba de catálogo usa `installBrandDelivery`, fixture existente de los contratos A/B del runtime; solo 001–047 no incluyen la vista `mail_conversations_visible`. No se crea ni modifica ninguna migración para resolver el fixture.
- Se ocultan filas de un filtro anterior mientras se carga uno nuevo. Los errores de guardado también se muestran dentro de los diálogos. La búsqueda se habilita después de la hidratación para conservar la primera entrada del usuario.
- Conteos que cambian durante paginación o IDs repetidos producen 503/reintento de lectura, evitando sumas duplicadas por escrituras concurrentes. Sigue siendo una observación de varias fuentes, no snapshot transaccional.
- QA usa Node 22.23.5 portátil verificado con SHASUMS oficial y dos copias de fuentes en carpeta temporal sin env. La copia de build necesita también worker/tests porque los scripts del repositorio los importan. Se corrigió la preparación de esa copia antes de acreditar el build; no se atribuyen esos fallos a código productivo.
