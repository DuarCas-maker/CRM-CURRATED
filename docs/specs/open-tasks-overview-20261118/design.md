# Diseño — resumen de tareas abiertas

STANDARD · spec v1 · 2026-11-18.

## Base observada

Next 16.3.8 App Router, React 19.3, TypeScript, CSS propio y lucide-react; pnpm 11.19. PipelineOSWorkspace conserva owner y query y pide /api/pipeline-os. buildPipelineBoard clasifica etapas y protege áreas por rol. campaign_contact_facts (043 y wrapper de Campaign Flow ya publicado) define el envío y respuestas acreditadas. La base de producción 8866e84 usa Campaign Control: deduplica contact_id en su resumen y limita campañas a campaign_group_members visible. No se utiliza delivery_stats: cuenta mensajes de seguimiento.

## Componentes y flujo

1. Nuevo agregador puro tasks-overview.ts: combina filas completas del board, leads, campañas, hechos de contactos y metadatos de conversaciones/mensajes. Produce resumen por responsable/cuenta y detalle paginado. FR-001–005.
2. Nuevo lector autenticado server/pipeline-tasks.ts: lectura paginada bajo RLS; limita campañas mediante campaign_group_members, reutiliza campaign_contact_facts con concurrencia acotada y readPipelineBoard con tamaño interno de catálogo. El agregador deduplica enviados por contact_id como Campaign Control, conservando el desglose por cuenta. Solo metadatos. FR-002/003/005.
3. GET /api/pipeline-os/tasks: q (máximo 200), owner/account (máximo 100), status all/managed/pending/replied, page entero no negativo. 200 resumen y detalle; 400 filtros inválidos; 401/403 sesión/permisos; 503 catálogo incompleto. Cache-Control private,no-store.
4. Nuevo TasksOverview: tabla inicial, desglose por cuenta, selección accesible por botones, filtros y lista paginada de leads. Las etapas llaman la navegación existente; los expedientes se abren en su modal habitual. FR-001/004/006.
5. Workspace integra el componente antes de las tarjetas y comparte owner/query. El componente permanece montado al cambiar filtros; oculta detalle obsoleto mediante clave de consulta y reutiliza WorkspaceReader (cancelación/versionado y límite de 30 segundos). El resumen no depende de la página de leads ni del responsable seleccionado.

## Permisos y datos

Se usa el cliente de requireUser, nunca service_role. Sin cambios de RLS, esquema o permisos. Los roles seller solo reciben sus leads/campañas; closers siguen limitados a sus expedientes/áreas. Campos financieros quedan fuera de la nueva respuesta; únicamente conteos de etapas ya autorizadas. Cuerpos de mensajes, adjuntos, tokens y outbox privado no se leen. Cuentas sin campañas aparecen con cero actividad confirmada. La falta de acceso a campañas se representa como no disponible, no como cero.

## Rendimiento y consistencia

Carga de esta lectura solo al abrir Tareas abiertas. Se leen páginas completas con count exacto y lotes de 50 IDs; las peticiones a hechos de campañas se acotan a cuatro simultáneas. La reutilización interna del board omite su resumen de campañas para evitar calcular otra métrica costosa que aquí no se usa; las llamadas existentes conservan los valores por defecto. No hay caché global entre usuarios. No se llama a proveedores. El cliente conserva el resumen al paginar/cambiar responsable y evita resultados de peticiones canceladas. Sin escrituras ni transacciones nuevas.

## Verificación y reversa

Unitarias de deduplicación, atribución y etapas; lector con REST cap reducido y errores; contrato HTTP y permisos; regresión del board, master y campañas; typecheck, build y fixture visual offline con teclado y tres anchos. Rollback: retirar la integración TasksOverview y sus archivos propios; deshacer solo el parámetro interno aditivo del board. No afecta datos persistidos ni WIP previo.
