# Contexto del proyecto — Curated Financial CRM

Fecha de corte: **13 de octubre de 2026**, zona horaria America/Bogota.

Este documento está pensado para entregarse a otra persona o asistente que ya tiene acceso al repositorio en GitHub. Resume el producto, las decisiones, la arquitectura, los flujos, la operación y el trabajo pendiente. Los enlaces y rutas son relativos al repositorio para que funcionen desde GitHub; no hace falta copiar todo el código al contexto.

## 1. Repositorio y alcance de este contexto

- Repositorio: [DuarCas-maker/CRM-CURRATED](https://github.com/DuarCas-maker/CRM-CURRATED).
- Nombre de aplicación: **Curated Financial CRM**. Paquete: `curated-financial-crm`, versión `0.1.0`, privado.
- Rama local al preparar este documento: `main`.
- Commit local de referencia: `b9307b0874ca5b7557c071cd8ee8ece0b32454e8` (`b9307b0`), del 12 de octubre de 2026: `Redesign Conversations with compact client selection and threaded email workspace`.
- La referencia local `origin/main` coincidía con ese commit. No se hizo `fetch` ni se comprobó si el remoto había avanzado.
- **Había cambios locales sin commit**, incluidos las migraciones 022 y 023 y las mejoras de conversaciones por empresa y portales. Tener acceso a GitHub no garantiza tener estos cambios: comprobar si se publicaron antes de utilizar sus archivos o funciones.
- El dominio de producción registrado en la documentación es `https://crm.finlabinc.com`, desplegado en Coolify. No se verificaron el despliegue, las variables ni la base de producción al elaborar este documento.

El contexto reúne evidencia del código y de la documentación existente. Cuando se describe una prueba o modificación previa de la base real, es un antecedente documentado, no una validación nueva. No contiene secretos, credenciales ni datos de expedientes.

## 2. Qué resuelve el producto

CRM interno de Curated Financial para gestionar el recorrido de financiación de empresas: preparación de leads, validación de correo, oportunidades, campañas y comunicación, aplicación y documentos, análisis, traspaso a closers, solicitudes a lenders, ofertas, aceptación y desembolso registrado.

La interfaz funciona en **español e inglés**, en computador, tableta y celular. Incluye PWA y notificaciones opcionales. La moneda de presentación es USD.

El modelo actual busca mantener **un expediente del cliente con varios procesos de financiación**. En ese expediente se relacionan contactos, documentación, tareas, historial y comunicaciones con cliente, equipo y lenders. Una nueva solicitud de un cliente con expediente se registra mediante **Añadir proceso**; no debe duplicar el expediente por el mismo correo. Los duplicados anteriores se conservan para conciliación explícita.

La implementación parte del PRD del 5 de octubre de 2026, según README. El documento PRD original y el formulario original de Curated no están incluidos entre los archivos inspeccionados. Las referencias funcionales disponibles son el código, las migraciones y `docs/`.

### Módulos principales de la interfaz

| Módulo | Función |
| --- | --- |
| Resumen | Vista de actividad e indicadores del universo autorizado. |
| Preparación de leads | Importación, revisión y verificación antes de crear oportunidades. |
| Oportunidades | Pipeline, responsables, etapas y apertura del expediente. |
| Conversaciones | Selector de cliente, proceso, bandeja, hilos, mensajes y respuestas. |
| Campañas | Remitente, audiencia, secuencias, horarios, límites y exclusiones. |
| Tareas | Próximas acciones y recordatorios, incluidos seguimientos de correo. |
| Lenders | Directorio de empresas, contactos, canales y referencias. |
| Indicadores | Métricas calculadas en Postgres sobre todos los casos autorizados y filtrados. |
| Configuración | Equipo, invitaciones, preferencias, cuentas Gmail, permisos, histórico y trabajos que requieren revisión. |

## 3. Arquitectura y stack

```text
Navegador / PWA
  ├─ Supabase Auth: sesión, invitación y MFA
  └─ Next.js: páginas, componentes y rutas /api
       ├─ Supabase Postgres: datos, RLS, funciones y transacciones
       ├─ Supabase Storage: archivos privados
       └─ Colas persistentes: jobs y outbox
            └─ Worker independiente
                 ├─ Gmail / Google OAuth / Pub/Sub opcional
                 ├─ Bouncer
                 ├─ Importaciones y PDF
                 └─ Notificaciones internas, correo y Web Push
```

### Versiones fijadas en `package.json`

| Tecnología | Versión / uso |
| --- | --- |
| Node.js | Rama 22; `engines` exige `>=22.13 <23`; `.nvmrc` contiene `22`. |
| pnpm | `11.19.0`, fijado mediante `packageManager` y Dockerfiles. |
| Next.js | `16.3.8`, App Router en `src/app`, salida `standalone`. |
| React / React DOM | `19.3.0`. |
| TypeScript | `7.0.2`, modo estricto, alias `@/*` → `src/*`. |
| Supabase | `@supabase/supabase-js 2.117.2`, `@supabase/ssr 0.12.7`. |
| Validación | Zod `4.6.5`. |
| Importación | ExcelJS `4.4.0` y PapaParse `5.7.0`. |
| PDF | `pdf-lib 1.17.1` para generar; `pdfjs-dist 6.4.299` para visualizar. |
| Google | `google-auth-library 11.1.0`. |
| Worker y pruebas | `tsx 4.23.15`; pruebas con `node:test` y PGlite `0.5.8`. |
| Interfaz / push | `lucide-react 1.52.0`, `web-push 3.6.7`. |
| Formato | Prettier `3.9.9`. No hay script de lint en `package.json`. |

**Regla de desarrollo del repositorio:** [AGENTS.md](../AGENTS.md) advierte que esta versión de Next.js tiene cambios respecto de versiones conocidas. Antes de modificar código Next.js, leer la guía relevante en `node_modules/next/dist/docs/` del paquete instalado. `CLAUDE.md` remite a `AGENTS.md`. No eliminar el bloque generado de reglas de Next: `next dev` lo vuelve a crear.

### Organización del código

| Ruta | Responsabilidad |
| --- | --- |
| `src/app/` | Páginas, layout, estilos globales, manifest y rutas HTTP. |
| `src/components/crm.tsx` | Contenedor principal, navegación, filtros, modales y acciones del CRM. |
| `src/components/opportunity-detail.tsx` | Expediente, checklist, análisis, solicitudes y ofertas. |
| `src/components/conversations-workspace.tsx` y `.css` | Espacio de conversaciones y diseño adaptable. |
| `src/components/mail-*.tsx`, `mailbox-status.tsx` | Selector, lectura, editor, archivos, estado y composición de correo. |
| `src/components/gmail-*.tsx`, `case-mail-history.tsx` | Histórico, equipo, progreso, evidencia, selección y vista previa de adjuntos. |
| `src/components/import-wizard.tsx` | Mapeo y confirmación de importaciones. |
| `src/components/application-form.tsx` | Formulario público de solicitud. |
| `src/lib/domain.ts` | Tipos, etapas, etiquetas, permisos de presentación y reglas de negocio compartidas. |
| `src/lib/demo.ts`, `demo-actions.ts` | Datos ficticios y acciones de la demostración. |
| `src/lib/server/` | Clientes Supabase, autorización, cifrado, OAuth, documentos, lectura y acciones de correo. |
| `worker/` | Procesamiento independiente de importaciones, verificación, correo, histórico, PDF y avisos. |
| `supabase/migrations/` | Esquema, políticas, funciones y cambios de negocio en orden numérico. |
| `supabase/install/` | Instaladores históricos agrupados; no sustituyen todas las migraciones actuales. |
| `tests/` | Pruebas de dominio, correo, seguridad, migraciones, permisos y carga. |
| `docs/` | Guías operativas, aceptación y antecedentes de validación. |
| `infra/minio-compat/` | Imagen de compatibilidad para el MinIO del despliegue Supabase. |

## 4. Modelo de datos y conceptos

Supabase es la fuente de verdad. El frontend no sustituye la base con datos ficticios si falla una integración.

| Concepto / tablas | Significado |
| --- | --- |
| `profiles`, `invitations` | Usuarios internos, roles, activación e invitaciones. |
| `companies`, `contacts`, `company_contacts` | Empresa, personas y correos vinculados; contactos principales, adicionales o intermediarios. |
| `leads`, `verifications`, tablas de importación | Contactos en preparación, resultados y trazabilidad de cargas/verificación. |
| `opportunities` | Expediente/oportunidad comercial, etapa, responsables y estado de preparación. |
| `company_primary_cases`, `financing_processes` | Expediente principal y procesos de financiación diferenciados. |
| `activities`, `tasks`, `analyses`, `case_events` | Notas, tareas, revisión financiera y línea del tiempo. |
| `documents`, aplicaciones y enlaces | Checklist, versiones, solicitud firmada y acceso público mediante token. |
| `lenders`, `lender_contacts` | Empresas financiadoras y correos de sus empleados. |
| `submissions`, `offers` | Solicitudes/evaluaciones por lender y ofertas concretas. |
| `campaigns`, `campaign_enrollments` | Secuencias comerciales e inscripción de contactos. |
| `mail_accounts`, `mail_permissions`, `mail_credentials` | Cuentas Gmail, permiso de envío y credenciales cifradas. |
| `conversations`, `messages`, `message_attachments` | Hilos físicos por buzón y mensajes, participantes y archivos. |
| `conversation_lenders` y funciones de indexación de 022 | Relaciones entre correo, empresas lender y vistas agrupadas; se reutilizan mensajes y conversaciones existentes. |
| `gmail_runs`, `gmail_candidates`, `gmail_archive_messages` | Análisis históricos, candidatos y archivo original cifrado. |
| `gmail_thread_links`, `gmail_import_effects`, `gmail_saved_attachments` | Asociación, trazabilidad de importación y archivos copiados. |
| `gmail_team_members`, `gmail_attachment_choices`, `gmail_known_emails` | Equipo interno, elección de archivos y detección de direcciones previas. |
| `mail_review`, asociaciones pendientes | Correo sin vínculo fiable o que exige revisión. |
| `mail_uploads`, `mail_drafts`, `mail_waits` | Archivos para correo, borradores privados y esperas/seguimientos. |
| `jobs`, `outbox` | Trabajo persistente y envíos con estado real. |
| `notifications`, preferencias, entregas y suscripciones | Avisos internos y canales externos opcionales. |
| `audit_log`, `command_receipts` | Auditoría y recibos idempotentes. |

No confundir **etapa de la oportunidad** con **estado de un proceso de financiación** ni con **estado de un envío**. Son entidades y recorridos distintos.

El workspace pagina leads y oportunidades de 100 en 100. Sus consultas relacionadas tienen límites de hasta 3.000 registros, y la carga inicial de mensajes hasta 1.000; el detalle permite recuperar historia adicional. Configurar el límite de filas de la API Supabase en al menos 3.000 según la guía existente. Los agregados globales se calculan en SQL: no inferir totales comerciales del contenido de una página.

Etapas de oportunidad en `src/lib/domain.ts`:

```text
new, contacting, replied, application_pending, documents_pending,
analysis, ready_for_closer, unassigned, lenders, offers, negotiation,
accepted, funding_pending, funded, lost, paused
```

Los procesos tienen estados propios en `src/lib/financing-history.ts`, desde `unclassified` y `new` hasta contrato, aprobación, desembolso, retiro del cliente o ausencia de financiación. Un archivo histórico pendiente de clasificar no cuenta como un proceso confirmado.

## 5. Roles y permisos

| Rol | Alcance general |
| --- | --- |
| `superadmin` | Administración global, equipo, integraciones y expedientes autorizados por el modelo. |
| `seller_admin` | Administración de sellers y acceso a expedientes del área comercial. |
| `seller` | Leads y oportunidades de su responsabilidad. |
| `closer_admin` | Expedientes traspasados y asignación de closers. |
| `closer` | Expedientes que tiene asignados. |

Los helpers de interfaz no son la barrera de seguridad: la autorización efectiva está en backend, funciones SQL y RLS.

- Acceso interno: usuario autenticado, perfil activo e invitación; MFA TOTP con JWT `aal2`.
- Registro público de usuarios deshabilitado; el primer superadmin se crea mediante invitación y Supabase Auth.
- Responsable comercial y cuenta remitente son independientes. Leer un expediente no concede envío desde cualquier cuenta; el permiso de remitente se administra por separado.
- Acceder a una cuenta Gmail no concede acceso a todos los expedientes del CRM.
- El dueño del buzón y el superadmin revisan correo todavía sin asociar. Tener permiso de envío no concede lectura de todo el correo pendiente de otro buzón.
- La edición comercial depende de rol, asignación y fase. El acceso compartido al correo no concede acceso de edición a análisis, ofertas o estados fuera de esos permisos.
- **Cambio relevante desde 021:** seller y closer asignados pueden consultar y responder el correo de su expediente después del traspaso. Las reglas antiguas de ocultar todos los correos posteriores al traspaso no describen completamente este gestor compartido. Revisar `can_mail_case` y las políticas de 021; las áreas financieras siguen teniendo controles independientes.

## 6. Flujos de negocio e invariantes

### Preparación de leads y Bouncer

1. Se importa CSV/XLSX o se crea un lead manualmente.
2. El lead permanece en preparación: no se crea automáticamente expediente, checklist ni oportunidad.
3. El usuario selecciona expresamente los contactos verificables.
4. El worker procesa Bouncer y conserva reserva, estado y resultado.
5. Solo un correo válido y no bloqueado convierte el lead a oportunidad, de forma transaccional y una sola vez.

Pestañas: **Bandeja de preparación**, **Convertidos a oportunidades**, **Inválidos / en riesgo**. Sus filtros y totales se aplican en servidor antes de paginar. Los errores técnicos permanecen pendientes; no se presentan como direcciones inválidas. Los inciertos pueden volver a verificarse cuando corresponde; los inválidos no son seleccionables.

La migración 008 conserva los expedientes anteriores y sus IDs/historial. Si una oportunidad ya fue válida, un resultado posterior no elimina el expediente; las campañas sí vuelven a comprobar la verificación vigente y las bajas.

Una petición a Bouncer con resultado de recepción incierto no se repite automáticamente. Recuperar el `provider_batch_id` y conciliar el lote mediante una operación administrativa auditada; no cambiar indiscriminadamente `uncertain_request` a `queued`.

### Importaciones

- CSV y XLSX, hasta **50 MB** y **50.000 filas**. XLS binario debe convertirse.
- Selección de hoja y mapeo de columnas antes de confirmar.
- Original en Storage privado; procesamiento persistente en bloques de **250 filas**.
- Progreso, duplicados, errores e informe descargable; reintentos idempotentes.
- Reimportar contactos no debe sobrescribir silenciosamente historial, responsables o decisiones existentes.

### Campañas

- Exigen verificación vigente válida, ausencia de exclusión/baja y elegibilidad.
- Cuenta remitente, responsable, presupuesto diario, zona horaria y franja de envío son configurables.
- Mensaje inicial y hasta 20 seguimientos; esperas de 1 a 90 días según documentación de aceptación.
- Variables admitidas por la validación de plantillas: `name`, `company`, `application_url`, `unsubscribe_url`.
- Una respuesta o baja detiene la secuencia correspondiente. Un mensaje antiguo recuperado no debe cancelar una campaña posterior a él.
- Campañas que llevan al formulario no se activan mientras el formulario real siga deshabilitado.
- La aprobación histórica permite ciertos envíos manuales; no convierte el correo en `valid` ni elimina Bouncer como requisito de campañas nuevas.

### Aplicación, documentación, análisis y traspaso

- Formulario público mediante token aleatorio de 256 bits, con vencimiento y revocación.
- Recoge empresa, propietarios, firma escrita y consentimiento. No incluye SSN en esta versión.
- La aplicación enviada se conserva cifrada e inmutable; el worker genera PDF con firma, declaración y fecha.
- El checklist inicial incluye aplicación y cuatro extractos; admite requisitos por producto y documentos adicionales.
- Documento recibido y documento aprobado son estados distintos.
- La carga de documentos de checklist acepta PDF/JPG/PNG, valida la firma de bytes y limita cada archivo a 20 MB. La carga de adjuntos para correo tiene un flujo distinto y acepta otros formatos.
- Traspaso: aplicación completa y firmada, documentos requeridos aprobados y análisis con resumen, conclusión y recomendaciones.
- El admin de closers asigna al closer. Cada lender conserva su solicitud y ofertas.
- Aceptar una oferta y registrar desembolso son operaciones distintas; el sistema no mueve dinero.
- Documentos enviados conservan ruta y hash de la versión utilizada, aunque después se actualice el archivo del expediente.

**Pendiente funcional:** cotejar el formulario existente de Curated y aprobar sus campos, declaraciones y firma. Hasta entonces, mantener `PUBLIC_FORM_ENABLED=false`; no inventar texto contractual.

## 7. Gmail y gestor de correo

### Tres capacidades que deben distinguirse

1. **OAuth y permisos:** conecta cuentas Workspace por organización y autoriza envío.
2. **Histórico:** análisis anual, selección, clasificación e incorporación explícita de candidatos e hilos.
3. **Recepción nueva desde 021:** flujo independiente de terminar o confirmar el histórico.

`GMAIL_HISTORY_ENABLED` es una bandera heredada que también habilita infraestructura y servicios avanzados del gestor. Para la operación completa de 021, la guía exige `true` en web y worker y migraciones correspondientes. El modo básico mantiene respuestas compatibles cuando está desactivada; no todas las funciones avanzadas quedan disponibles.

### Conexión y sincronización

- OAuth por organización de Google Workspace, con validación del dominio `hd`, estado de un solo uso y refresh tokens cifrados.
- Scopes: `openid`, `email`, `gmail.readonly`, `gmail.send`.
- Callback: `${APP_ORIGIN}/api/gmail/callback`.
- `GMAIL_SYNC_MODE=polling`: consultas periódicas sin necesidad de Pub/Sub.
- `GMAIL_SYNC_MODE=pubsub`: notificaciones autenticadas y renovación de watch; también conserva reconciliación periódica.
- Variable ausente/vacía usa `pubsub` por compatibilidad. Un valor distinto de los admitidos produce error.
- En `polling`, el endpoint push responde 204 y no procesa notificaciones antiguas.
- Consultas aproximadamente cada minuto en el flujo nuevo; cola, carga, cuotas y reintentos pueden retrasarlas. No garantizar recepción instantánea.
- `mail_accounts.live_enabled` controla recepción nueva; `sync_enabled` conserva el significado histórico. Conectar/reconectar habilita la lectura nueva y encola la primera sincronización.
- La primera recepción nueva recupera el día anterior a su activación; el cursor expirado recupera desde la última lectura con solapamiento.
- Actualizar un expediente también solicita releer hilos ya asociados.

### Histórico e incorporación

- Lee recibidos, enviados y archivados del año, excluyendo spam, papelera y borradores.
- Analizar no crea por sí solo clientes ni oportunidades. La selección y confirmación son explícitas.
- Se muestran participantes, fechas, actividad mensual, coincidencias, duplicados potenciales y documentos.
- No unir empresas por nombres parecidos. Candidatos en copia o asociaciones ambiguas requieren revisión.
- Conserva progreso, cursores, pausa, reanudación, efectos de importación y opción de deshacer con protección del trabajo posterior.
- Los archivos originales y adjuntos copiados del histórico se cifran.
- Los porcentajes usan una estimación de Gmail. Si falta o resulta insuficiente, no mostrar un 100 % falso ni prometer duración exacta.
- Errores de cuota respetan `Retry-After`, espera persistida y reducción del ritmo por cuenta. El presupuesto en memoria es por proceso; no hay coordinación global de cuotas entre múltiples workers.
- La selección del análisis se conserva mediante ID en `sessionStorage`; las lecturas tienen timeout y conservan el estado previo ante fallos. Las acciones comerciales no se reintentan como simples lecturas.

### Correo nuevo, redacción y archivos

- Un hilo ya vinculado conserva el expediente. Un hilo personal nuevo requiere selección manual de expediente y proceso, incluso si su contacto es conocido.
- Recibir correo no crea automáticamente lead, oportunidad ni verificación. Se puede crear un lead manual desde un remitente nuevo pendiente.
- Responder usa por defecto la cuenta del hilo; permite otra cuenta conectada y autorizada, conservando referencias RFC y sin reutilizar el ID de hilo de otro buzón.
- Responder a todos conserva destinatarios visibles pertinentes y excluye BCC y cuentas propias.
- Solicitar a varios lenders genera correos individuales, con estados independientes, sin revelar destinatarios de otros lenders.
- Firma HTML de Gmail con alternativa de texto; vista previa aislada sin cargar imágenes externas.
- Adjuntos de expediente, del correo o del computador. Los recibidos se copian con trabajos independientes y quedan pendientes de revisión; fallo de copia no bloquea el mensaje.
- Archivos recibidos de más de 20 MB conservan referencia, pero no se copian ni descargan por esa vía.
- Envío: hasta **20 adjuntos** y **18 MB** agregados antes de codificar MIME; el worker vuelve a comprobar el tamaño.
- Borradores guardados explícitamente, privados del autor y propios del CRM; no se sincronizan con Borradores de Gmail.
- Estados visibles: en cola, enviando, enviada, pausada, incierta o fallida. La vista consulta el envío pendiente cada cinco segundos con la página visible y lo sustituye por el mensaje confirmado sin duplicarlo.
- Resultado incierto se concilia por `Message-ID`; no repetir a ciegas el POST de Gmail. Una reconexión no reactiva automáticamente envíos pausados.
- Respuestas generan avisos internos. Tras cinco días calendario de espera se generan tareas/borradores para revisión, sin enviar respuestas automáticamente.
- Ofertas, decisiones y análisis siguen siendo manuales; no hay interpretación semántica por IA en esta etapa.

## 8. Conversaciones: diseño y decisiones vigentes

El rediseño parte de un prototipo aprobado referido como `index (4).html`; ese archivo no está en el listado del repo inspeccionado. Conserva la paleta negra, champagne y bronce, los iconos y componentes del CRM.

- Selector compacto de cliente arriba, bandeja a la izquierda y lectura a la derecha.
- Búsqueda por contacto, empresa, correo principal y correos vinculados; resultados autorizados y paginados de 50 en 50.
- Contexto por expediente y proceso; pestañas Todos, Cliente, Equipo y Lenders, con conteo de hilos únicos.
- Resumen de antigüedad del último correo entrante del cliente, documentos requeridos aprobados, próxima acción y lenders contactados.
- Búsqueda en mensajes, filtro de atención pendiente y bandeja de correo sin asociar.
- Orden inicial: más reciente primero. Cambiar orden conserva borrador y páginas cargadas.
- Scroll propio para bandeja e historial; en móvil se alterna lista/detalle con botón Volver. Se ocultan encabezado grande y pie del CRM solo en esa pantalla.
- Respuesta integrada debajo del mensaje elegido; nuevo correo y reenvío son acciones distintas.
- Cuerpos se presentan como texto escapado. Firmas e historial citado de Outlook se pliegan visualmente sin eliminar el original.
- Las lecturas de resúmenes usan cabeceras/snippets; el detalle carga mensajes paginados.

Decisiones que no deben sustituirse por supuestos:

- **Porcentaje de seguimiento:** no hay fórmula oficial; mostrar «No definido».
- **Pendiente de atención:** usa `conversations.needs_attention`; no equivale a Gmail `UNREAD`. Abrir correo no modifica lectura en Gmail.
- **Correo de empresa:** `companies` no tiene un correo propio; buscar direcciones vinculadas en contactos.
- **Sin asociar:** contadores por categoría corresponden a la página cargada; el total de pendientes se muestra aparte.

### Cambio local: conversaciones por empresa lender (022)

La vista Lenders agrupa por **expediente + proceso de financiación + empresa lender**, reuniendo sus empleados, cuentas del equipo e hilos originales. Solo aparece si hay mensajes, sin crear chats vacíos para todo el directorio.

- Resolución por correo exacto; después por dominio propio que corresponda a una sola empresa. Gmail/Outlook y otros dominios compartidos requieren correo exacto.
- Un entrante pertenece a la empresa del remitente, aunque otros lenders estén en copia. Un saliente compartido aparece como contexto en cada empresa destinataria sin duplicar su registro.
- Empresas desconocidas en intercambios ya identificados pueden quedar como `Por confirmar · dominio`; no se inventan razón social, productos ni criterios.
- La indexación histórica recorre primero empresas conocidas y después provisionales. Mensajes automáticos, cliente, equipo e intercambios independientes no generan provisionales indiscriminadamente.
- El detalle solicita los IDs de mensajes de la empresa elegida, en páginas de 100 por conversación original, evitando mezclar respuestas de otras empresas.
- Responder usa el mensaje real y sus referencias. Para un saliente compartido elige un destinatario de esa empresa.
- Responder a todos agrega esa empresa y equipo, excluyendo cliente, otros lenders, la cuenta remitente y BCC. El backend vuelve a validar todos los vínculos y permisos.
- Existe respuesta básica `lender_reply` sin activar la integración avanzada; firma, adjuntos avanzados, nuevo correo y reenvío mantienen sus controles.
- Responder a correo histórico no crea automáticamente evaluaciones ni hereda la evaluación de otro lender del hilo mixto.

022 añade nombres de contactos, clasificación/indexación y respuesta por empresa e importa una tabla aprobada de 32 empresas y 55 correos. Reutiliza empresas con coincidencias inequívocas; conflictos, empresas archivadas o direcciones contradictorias abortan la transacción. No incorpora productos ni condiciones financieras que no se hayan entregado.

### Cambio local: directorio y portales (023)

Antecedentes registrados en `docs/CONVERSATIONS.md`: se añadieron en la base configurada 12 empresas y 18 correos, se completaron 13 nombres vacíos y se archivó un registro provisional de Ricardo como lender. La comprobación previa documentada encontró los 107 correos del Excel registrados. Quedaban 19 nombres provisionales por confirmar. No se volvió a consultar esa base durante este documento; el Excel de referencia no está en el listado del repo inspeccionado.

La migración 023 está preparada para converger el directorio y soportar portales:

- Varios lenders de canal `portal` sin correo; no inventar direcciones.
- Validación de URL HTTPS sin credenciales y exclusión de direcciones internas de Curated como lenders.
- Portales registrados: Loan Stacking, Idea y Rapid. MS Equities sigue pendiente de correo o enlace.
- URL guardada en `notes` con formato `Portal: https://...`; no hay columna nueva de portal.
- Unión del alias `fundingfutures.biz` con el ID existente de MCA Deals bajo Funding Futures, preservando mensajes, evaluaciones, montos, referencias y auditoría.
- Nuevo formulario en `src/components/lender-form.tsx` y validación compartida en `src/lib/lender-directory.ts`.
- Lenders sin correo se excluyen de la selección de destinatarios de correo.

**Estado documentado:** 022 y 023 estaban pendientes de aplicar en Supabase. La carga de ciertos datos reales no implica que esas migraciones estén instaladas. El nuevo código de aplicación seguía sin commit al preparar el contexto.

## 9. Seguridad y persistencia

- `requireUser()` verifica sesión real con Supabase, MFA `aal2` y perfil activo.
- `checkOrigin()` valida el origen de mutaciones frente a `APP_ORIGIN`; admite los dos orígenes locales de puerto 3000 en desarrollo.
- Mutaciones internas se encaminan a `crm_command` y funciones especializadas según acción; conservan permisos, transacciones y claves de idempotencia. El sobre de `/api/actions` contiene `kind`, `payload`, `idempotency_key` UUID.
- `userClient()` opera con sesión/cookies bajo RLS; `serviceClient()` y el worker usan service role solo en servidor. Las operaciones privilegiadas requieren validación explícita del acceso.
- Cifrado AES-256-GCM con clave de 32 bytes en base64; hashes SHA-256 y tokens aleatorios de 32 bytes.
- **Conservar la clave de cifrado existente** entre web, worker y despliegues. Cambiarla sin migración vuelve ilegibles credenciales y datos cifrados previos.
- Buckets privados, versiones y descargas autorizadas; documentos de expediente usan URLs firmadas de 60 segundos después de comprobar acceso. Los archivos cifrados de correo siguen sus rutas de lectura autorizadas.
- No exponer service role, OAuth secrets ni claves privadas mediante `NEXT_PUBLIC_*`, build args, logs o Git.
- Cabeceras de seguridad y CSP en `next.config.ts`; `form-action` permite explícitamente `accounts.google.com` para la redirección OAuth.
- Web y datos sensibles usan `no-store`; el service worker no almacena expedientes ni ofrece acceso offline a sus respuestas.
- Evitar registrar completos los paths `/apply/*` y `/unsubscribe/*`: contienen tokens de acceso.
- Avisos externos genéricos y logs del worker sin cuerpos de correo ni contenido financiero.

## 10. Rutas y servicios que conviene localizar

| Ruta | Uso |
| --- | --- |
| `/` | CRM persistente; redirige al login si falta configuración o acceso. |
| `/login`, `/auth/confirm`, `/auth/password` | Invitación, sesión, contraseña y MFA. |
| `/demo`, `/apply/demo` | Demostración ficticia; cambios en memoria y envío simulado. |
| `/apply/[token]`, `/unsubscribe/[token]` | Solicitud pública y baja mediante token. |
| `/api/health` | Liveness de web; devuelve `status: ok`, `service: curated-crm`. |
| `/api/workspace` | Workspace autorizado, filtros, paginación y estadísticas. |
| `/api/actions` | Comandos de negocio y despacho de acciones de correo. |
| `/api/import`, `/api/import/preview`, `/api/import/[id]/report` | Vista previa, importación e informe. |
| `/api/documents`, `/api/documents/[id]`, `/api/application-links` | Documentación privada y enlaces de aplicación. |
| `/api/public/applications/[token]`, `/api/public/documents/[token]`, `/api/public/unsubscribe/[token]` | Operaciones públicas limitadas por token. |
| `/api/gmail/connect`, `/callback`, `/config`, `/push` | OAuth, configuración y notificaciones Gmail. |
| `/api/gmail/history`, `/team`, `/cases/[id]`, `/archive/[id]` y `/archive/[id]/thread` | Histórico, equipo, expediente y evidencia original. |
| `/api/gmail/attachments`, `/attachments/preview`, `/files/[id]` | Selección, vista previa y descarga autorizada. |
| `/api/conversations/clients`, `/channels`, `/[id]/messages` | Selector, resumen/canales y mensajes paginados. |
| `/api/mail`, `/review/[id]`, `/uploads`, `/uploads/[id]`, `/sent-files` | Gestor, pendientes, archivos y versiones enviadas. |
| `/api/push`, `/api/auth/logout` | Web Push y cierre de sesión. |

Las rutas abreviadas dentro de una celda continúan el prefijo inicial correspondiente; consultar `src/app/api/` para métodos, validaciones y contratos exactos.

## 11. Worker y fiabilidad

`worker/index.ts` corre como proceso independiente. Reclama jobs mediante RPC, renueva reservas y confirma con lease token para impedir que un proceso con reserva vencida confirme resultados de otro. La cola conserva deduplicación, reintentos y alertas de fallo.

Tipos de trabajo observados: `import`, `scrub`, `scrub_poll`, `gmail_sync`, `gmail_live_thread`, `gmail_archive`, `gmail_team_thread`, `gmail_copy_attachment`, `gmail_message`, `gmail_watch`, `pdf`, `notify`.

El worker también programa campañas, intenta enviar outbox y concilia envíos inciertos. La programación general ocurre aproximadamente cada minuto; sin trabajo espera unos segundos. Atiende SIGTERM/SIGINT y mantiene archivo de latido.

Un job marcado `completed` significa que terminó ese trabajo, no que haya terminado necesariamente todo el análisis anual ni que un envío haya sido entregado. Comprobar el estado de la entidad correspondiente.

Notificaciones internas funcionan sin Web Push. Correo de notificación necesita `NOTIFICATION_GMAIL_ACCOUNT_ID`; comparte el presupuesto de esa cuenta. Push necesita VAPID y, en iPhone, instalación en pantalla de inicio según la interfaz.

## 12. Base de datos y migraciones

Las migraciones **no se ejecutan automáticamente** al desplegar. Revisar qué está instalado, respaldar y aplicar únicamente lo pendiente en orden. No tratar todos los SQL como scripts repetibles.

| Número / grupo | Propósito |
| --- | --- |
| 001–003 | Núcleo, comandos y workflows/operaciones persistentes. |
| 004–007 | Integraciones, visibilidad de correo, métricas e historial. |
| 008 | Separación de leads en preparación y oportunidades verificadas. |
| 009–015 | Archivo e incorporación Gmail, evidencia, vista previa, procesos, respuestas con archivos y sincronización continua. |
| 016 | Correo manual y su cola. |
| 017 | Equipo interno y reglas de incorporación de sus conversaciones. |
| 018 | Selección de adjuntos históricos. |
| 019 | Gmail incremental y correos conocidos. |
| 020 | Canales, contactos de lenders y asociaciones. |
| 021 | Gestor de correo, recepción independiente, archivos, borradores y acceso compartido al correo. |
| 022, local sin commit | Conversaciones por empresa lender, directorio e indexación/respuesta. |
| 023, local sin commit | Directorio ampliado, portales sin correo y conciliación de alias. |

Instaladores agrupados:

- `supabase/install/curated-initial.sql`: copia de 001–007 al 6 de octubre y una invitación inicial específica; no crea el usuario Auth. Rechaza un esquema `public` con tablas. No usarlo como actualización ni ejecutarlo además de esas migraciones individuales.
- `supabase/install/gmail-history.sql`: actualización atómica 009–015 desde 001–008. No incluye 016–023 y no se debe ejecutar además de los mismos SQL individuales.
- Instalación nueva: revisar los archivos presentes en la rama e instalar la secuencia aplicable. Si 022/023 no están publicadas, el checkout de GitHub solo tendrá hasta 021 en esta referencia.
- Instalación existente: no deducir las migraciones instaladas del commit, del contenido de README ni de un healthcheck. Confirmar esquema y antecedentes del entorno.
- La documentación más reciente registra que el usuario confirmó 021 instalada. 022/023 seguían pendientes; no se auditó producción en esta revisión.
- Error `unterminated dollar-quoted string` en 021 se reprodujo con ejecución de un fragmento incompleto. La guía pide cerrar la transacción fallida con `ROLLBACK;`, verificar estado y ejecutar el archivo íntegro desde `begin;` hasta `commit;`, sin inventar un cierre para una función truncada.

## 13. Variables y operación local

Fuente de nombres: [.env.example](../.env.example). Detalle por Build/Web/Trabajador: [docs/ENVIRONMENT.md](ENVIRONMENT.md).

| Variables | Condición |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build y Runtime de web; URL también en worker. Son configuración pública, no service role. |
| `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, `INTEGRATION_ENCRYPTION_KEY` | Runtime de web y worker; conservar los valores del entorno existente. |
| `BOUNCER_API_KEY` | Runtime de ambos al usar verificación. |
| `GOOGLE_OAUTH_ORGANIZATIONS` | JSON de organizaciones con `id`, `domain`, `clientId`, `clientSecret`; añadir `pubsubTopic` solo si corresponde. Secreto de Runtime. |
| `GMAIL_SYNC_MODE`, `GMAIL_HISTORY_ENABLED` | Mismo valor en web y worker; habilitar servicios tras instalar su esquema. |
| `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Necesarios según configuración de Pub/Sub; ignorados en polling. |
| `PUBLIC_FORM_ENABLED`, `FORM_DECLARATION_VERSION`, `FORM_DECLARATION_TEXT` | Formulario y campañas dependientes; mantener deshabilitado hasta validación. |
| `DEMO_ENABLED` | `/demo` está deshabilitada en producción salvo activación explícita; desarrollo permite demo. |
| `NOTIFICATION_GMAIL_ACCOUNT_ID` | UUID de cuenta conectada para avisos por correo. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push opcional; privadas solo en servidor/worker. |
| `WORKER_HEARTBEAT_FILE` | Archivo local de latido; Docker fija `/tmp/crm-worker-heartbeat`. |

Las variables públicas quedan incorporadas al build del navegador y la CSP. Cambiarlas solo en Runtime no actualiza el bundle: reconstruir la web. `APP_ORIGIN` es el origen de cada entorno, sin rutas ni parámetros; en producción coincide con el dominio HTTPS del CRM.

Comandos desde la raíz, después de configurar el entorno local:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm dev
```

En otra terminal, para procesar trabajo persistente:

```sh
pnpm worker
```

Scripts adicionales:

```sh
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:load
pnpm build
pnpm start
pnpm worker:production
```

`worker` carga `.env.local`; `worker:production` recibe variables del proceso. `dev` escucha en `127.0.0.1`. `dev` y `build` ejecutan `scripts/prepare-pdf-viewer.mjs`, que prepara worker, CMaps y fuentes de PDF.js en `public/pdfjs/`; esa carpeta es generada y está ignorada por Git. `pnpm-workspace.yaml` autoriza el script de instalación de esbuild.

No arrancar un worker contra un entorno real solo para validar código: procesará trabajos pendientes. Revisar siempre el destino configurado para una prueba operativa.

## 14. Despliegue

Dos recursos separados de Coolify, desde el mismo repositorio y versión:

| Recurso | Configuración |
| --- | --- |
| Web | `/Dockerfile`, base `/`, puerto interno 3000, dominio HTTPS, servidor standalone como usuario sin privilegios. |
| Worker | `/Dockerfile.worker`, base `/`, sin dominio ni puerto público; ejecuta TypeScript con `tsx`. |

- Web: `NEXT_PUBLIC_*` para Build y Runtime; secretos solo Runtime.
- Worker: URL Supabase, service role, cifrado, origen e integraciones en Runtime. No necesita anon key ni variables de build.
- Web healthcheck: GET `http://127.0.0.1:3000/api/health`, respuesta 200; intervalo 30 s, timeout 5 s, inicio 30 s, 3 reintentos.
- Worker healthcheck: archivo de latido; no configurar un healthcheck HTTP.
- Dominio público sin `:3000`. Actualizar Site URL y redirects de Supabase Auth y callback de Google para ese origen.
- El flujo habitual documentado es commit/push a `main` para activar el despliegue de Coolify. Este documento no confirma que esa integración esté operativa hoy.
- `compose.yaml` permite construir y ejecutar ambos recursos usando `.env.local`.
- Supabase/Google Cloud son externos a estos Dockerfiles: no provisionan Postgres, Auth, Storage ni OAuth.
- Proxy: admitir cargas de 50 MB y tiempos suficientes. Configurar respaldo, retención y protección de logs.
- La documentación anterior señala que Docker no estaba instalado en el entorno local: build y healthchecks dentro de contenedores quedaron para verificación en servidor. No se volvió a comprobar Docker aquí.

Compatibilidad de almacenamiento: `infra/minio-compat/` contiene una imagen alternativa para un servidor donde la base UBI9 de MinIO falla por requerir CPU x86-64-v2. Conserva los ejecutables fijados por digest sobre Alpine; su guía exige probar en destino y conservar configuración/volúmenes de Supabase. No asumir que esa imagen local existe en otro servidor.

## 15. Pruebas, evidencia y límites

La suite usa `tsx --test tests/*.test.ts`. `tests/database.ts` crea un Postgres PGlite desechable, simula Auth/Storage, aplica las migraciones presentes en orden y prueba reglas por roles. `test:load` habilita 50.000 filas sintéticas sobre ese mismo entorno, sin enviar contactos a proveedores.

Cobertura existente: dominio y traspaso; preparación/importación; campañas y seguridad; Gmail, cuotas, recuperación y sincronización; archivos; envío, respuesta, reenvío y firma; gestor y borradores; canales e identidad de hilos; directorio y conversaciones de lenders.

Última validación **documentada** del estado local ampliado en `docs/CONVERSATIONS.md`:

- 92 pruebas aprobadas, build de producción y TypeScript correctos.
- Aceptación de migraciones 001–023 y pruebas de portales, exclusión de correos internos, alias y conservación de referencias/mensajes.
- Validaciones anteriores de navegador con servicios ficticios: agrupación por empresa, hilo mixto, paginación de 100 a 136 mensajes, respuesta desde otra cuenta, copias, escritorio/tableta/móvil y scroll propio.
- Hubo una comprobación local autenticada de lectura con servicios reales; no constituye prueba de entrega.
- No se aplicó 023 ni se probó guardar un portal contra la base real según ese documento. Tampoco se ejecutó importación/respuesta real de New Day para el cambio de 022.

**No se ejecutaron nuevamente esas pruebas al redactar este contexto.** Sus resultados pertenecen a las sesiones documentadas y a versiones concretas. Antes de un cambio nuevo, ejecutar las comprobaciones pertinentes sobre su estado actual.

PGlite y transportes simulados no equivalen a pruebas completas contra Supabase/Gmail de producción. `/api/health` solo demuestra que la web responde; el latido del worker solo demuestra vida del proceso. Validar por separado cola, importación pequeña, permisos, OAuth, archivos y entrega con buzones controlados.

## 16. Pendientes y prioridades para continuar

1. **Alinear GitHub, base y despliegue:** comprobar si el trabajo local de 022/023 ya se publicó; verificar migraciones realmente instaladas y preparar un despliegue compatible de web/worker. No aplicar SQL pendiente solo por recibir este documento.
2. **Validar el cambio de lenders:** agrupación por empresa/cliente/proceso, aislamiento de destinatarios, respuestas con cuentas autorizadas y continuidad del hilo real; confirmar nombres provisionales restantes y datos faltantes de MS Equities.
3. **Probar portales en el entorno correspondiente** después de instalar 023: múltiples lenders sin correo, validación HTTPS, tarjetas y exclusión de envío por email.
4. **Completar el piloto de correo:** ida y vuelta con buzones autorizados, sincronización sin histórico confirmado, firmas/archivos, CCO, cambio de remitente, reconexión, cuotas y resultados inciertos.
5. **Validar el formulario original:** campos, consentimiento, firma y PDF; mantener la recepción real deshabilitada mientras falte esa definición.
6. **Completar aceptación operativa:** los cinco roles, RLS/Auth/Storage reales, Bouncer con muestra controlada, campañas/respuesta/baja, carga en servidor y reinicio del worker.
7. **Funciones futuras sin implementar:** OCR/extracción semántica, reconstrucción automática de ofertas y evaluaciones, modelo de riesgo por IA y atribución completa de rebotes DSN por dirección. Requieren definición, proveedor y presupuesto; no asumir que están activas.
8. **Definiciones pendientes:** fórmula de porcentaje de seguimiento y, si se desea, lectura `UNREAD` de Gmail. No inventar indicadores para llenar espacios de la interfaz.
9. **Escala:** búsquedas amplias de contactos y expedientes con mucho correo pueden necesitar optimización; conservar paginación y agregados reales, sin reemplazarlos por conteos de la página.

## 17. Cómo usar este contexto con acceso al repo

Para quien continúe el trabajo:

- Leer primero `AGENTS.md`, este documento y los archivos concretos del área solicitada.
- Revisar rama/commit y cambios disponibles. La fecha de este documento no convierte sus referencias de código o despliegue en estado actual.
- Usar el código y la secuencia de migraciones como contrato técnico; consultar la guía operativa más reciente del módulo. Documentos antiguos pueden describir reglas sustituidas por migraciones posteriores.
- Mantener los invariantes de autorización, idempotencia, historial, separación entre lead/expediente/proceso y envío incierto.
- Preservar datos y referencias existentes; no deduplicar, renombrar o reasignar silenciosamente empresas/contactos ante coincidencias ambiguas.
- Reutilizar componentes, paleta, idiomas y comportamientos responsive existentes.
- Confirmar configuración efectiva antes de atribuir un problema a una bandera o integración. El modo básico y el avanzado tienen comportamientos deliberadamente distintos.
- Consultar las guías instaladas de Next antes de escribir código del framework y ejecutar validaciones apropiadas al cambio.
- No afirmar que algo está aplicado, desplegado o entregado basándose únicamente en código local, una prueba simulada o HTTP 200.

### Fuentes dentro del repositorio

| Documento / archivo | Para qué consultarlo |
| --- | --- |
| [README.md](../README.md) | Introducción, instalación, Auth, integraciones y Docker/Coolify; contiene antecedentes de etapas anteriores. |
| [AGENTS.md](../AGENTS.md) | Reglas específicas de Next.js para agentes. |
| [package.json](../package.json) | Versiones y comandos exactos. |
| [.env.example](../.env.example) | Nombres de variables y valores de ejemplo. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Matriz Build/Web/Trabajador y configuración de dominios/OAuth. |
| [CONVERSATIONS.md](CONVERSATIONS.md) | Rediseño, decisiones de interfaz, agrupación por empresa, directorio/portales y evidencia más reciente. |
| [MAIL-MANAGER.md](MAIL-MANAGER.md) | Gestor 021, recepción independiente, activación y piloto. |
| [GMAIL-HISTORY.md](GMAIL-HISTORY.md) | Importación anual, selección, límites y etapas históricas. |
| [MAIL-PILOT.md](MAIL-PILOT.md) | Recorrido de aceptación del correo manual. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Criterios del MVP y validación externa pendiente; fechado en una etapa anterior. |
| [DEPLOYMENT-CHECKS.md](DEPLOYMENT-CHECKS.md) | Antecedentes de pruebas/despliegues y límites de cada comprobación. |
| [infra/minio-compat/README.md](../infra/minio-compat/README.md) | Problema de CPU del almacenamiento y alternativa de imagen. |
| `supabase/migrations/`, `tests/` | Contratos de datos, permisos y evidencia ejecutable. |

Este documento queda completo como contexto portable; para implementar una tarea específica, abrir sus archivos en el repositorio en lugar de inferir detalles ausentes.
