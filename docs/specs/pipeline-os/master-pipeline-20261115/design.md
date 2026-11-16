# Diseño y ADR MP-01

## Decisión

Una vista Master Pipeline dentro de `PipelineOSWorkspace`, un componente propio y un endpoint GET nuevo. Se reutilizan estilos/tokens y aperturas de expediente/conversación existentes. Las tablas actuales y sus rutas mantienen su contrato. La tabla por asesor permanece disponible para cambiar de filtro sin perder las seis pestañas.

La preparación ocurre en snapshot público aislado; la integración posterior enumerará cada archivo y su hash de base. No se escriben componentes del checkout coordinador durante esta preparación.

## Lecturas y seguridad

El endpoint obtiene `requireUser()` y usa únicamente su cliente Supabase con RLS. Consulta IDs de expedientes visibles, aplica `canSeeOpportunity` y `canSeeArea`, y restringe ofertas/procesos al área closer antes de leerlos. Las páginas de catálogo usan el lector exact-count existente y límites explícitos; un error/lectura incompleta se presenta como error, no como cifras parciales.

El modelo puro recibe metadatos y devuelve únicamente datos autorizados y la página visible. Los cuerpos de mensajes se recuperan solo para los IDs mostrados, después de aplicar alcance/filtros, y se convierten en extractos de texto. No se leen payloads cifrados, credenciales o adjuntos. El archivo HTML no se incorpora al repositorio.

Para respuestas de leads se reutilizan conversaciones CRM y metadatos pendientes ya autorizados. El archivo de correo conserva su RLS de superadmin: otros roles no adquieren acceso por esta vista. Si esa cobertura no está disponible, el panel lo indica y deja los conteos afectados sin dato en lugar de presumir cero.

## Etapas y métricas

- Submitted: proceso enviado/evaluación del lender.
- Stips requested: proceso/requisitos adicionales registrados.
- Approved: ofertas vigentes o lender seleccionado, como equivalencia de vista; no certifica una aprobación final distinta de la registrada.
- Contracts out: contrato enviado; firma confirmada se conserva como estado adicional propio.
- Funded: desembolso con fecha/importe registrados, o evidencia explícita del proceso desembolsado. Nunca por firma de aplicación.
- Declined: proceso sin financiación; retirada del cliente y pausa no se etiquetan como rechazo de lender.
- Otras etapas conservan su denominación CRM o «Por clasificar».

Tareas se deduplican por ID y atribuyen a `owner_id`; P1 hereda la prioridad operativa del expediente. Ofertas por asesor cuentan ofertas vigentes. En resultados y series diarias, la actividad cuenta ofertas registradas con fecha en el período, incluidas las que vencieron después; los casos con oferta se deduplican por expediente. Correo se deduplica mediante archive_message_id/id, sin contar drafts/failed como enviados. Una respuesta posterior solo se acredita en la conversación correspondiente y su revisión de origen debe estar aprobada; empates de tiempo no prueban respuesta posterior. Filtros y conteos se aplican antes de paginar.

Las series usan `case_events` con evidencia manual/explícita, fechas de ofertas y eventos de aplicaciones/documentos recibidos. El desembolso legado con importe positivo y funded_at válido aporta su fecha registrada si el expediente no tiene evento explícito de desembolso, evitando duplicarlo. Registros sin fecha válida no se atribuyen al día de edición. UTC se usa como clave de período explícita y se presenta el contexto en pantalla, sin depender de la zona del servidor.

## Compatibilidad

Se conserva la prioridad y clasificación base de Pipeline OS. Si es necesario obtener todas las filas para el nuevo agregado, la reutilización del constructor mantiene el tamaño50 por defecto de las rutas antiguas y usa un tamaño interno explícito en Master Pipeline. Se prueba el caso de más de50 expedientes.

## Recuperación

Cambio local de lectura, sin datos escritos. Retirar el acceso/componente y endpoint restaura la interfaz anterior; no hay reversa SQL. Publicar o integrar en el checkout coordinador requiere revisión del parche y autorización concreta del alcance final.
