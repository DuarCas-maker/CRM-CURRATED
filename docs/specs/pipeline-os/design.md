# Diseño técnico de la reestructuración Pipeline OS

## CAPP-R47: rollout aditivo y candidato por contenido — 29/10/2026

[Runbook](s00/instantly-047-release-runbook.md): 047 primero, comprobación de catálogo, publicación de la app existente con flagfalse y smoke de seis HTTP sin credenciales; no ejecutar RPC para probar la instalación apagada. Conserva046/047 al recuperar la revisión/imagen saludable identificada. El [manifiesto](s00/instantly-047-release-manifest.json) fija SHA de20 archivos de código/SQL/tests y de la migración, ligados a la copia QA681; documentación enumerada aparte para evitar autorreferencia. HEAD/índice y remoto no cambian; el commit se registrará cuando se autorice publicar el contenido concreto.

## CAPP-ADR01 implementada localmente — 29/10/2026

[Diseño/contratos](s00/instantly-c-app-bridge.md) y [evidencia de implementación](s00/instantly-c-app-validation.md). 047 añade lease y cuotas técnicas con RPC de backend y snapshot mínimo; invoca 046 dentro de la transacción. Dos rutas nuevas con flag false, UI en Integraciones y v9 en el mismo journal; el estado proveedor reutiliza C/v8. El cierre precede al snapshot final y a la revocación. Un fallo durable detiene nuevas peticiones y requiere recuperación explícita. Sin dependencias, infraestructura, worker o secretos de servidor nuevos; no desplegado.

## CAPP-ADR01: lease temporal y control transaccional — 29/10/2026

[Diseño integrado C_APP](s00/instantly-c-app-bridge.md), respuesta9→A. La CLI actual observa archivos y el control publicado solo ofrece summary; planificar ticket opaco hash-only emitido tras superadmin/MFA/origen, limitado a nonce/source/manifiesto/actor/TTL10min. Futura047 (sin editar046) añade lease/cuotas/RPC de control que invoca046 en una transacción, una petición DB por API de control, sin API key Instantly en servidor o cookie en CLI. Snapshot final tras close, polling≥10s/≤12 y revocación; v9 integrado propuesto conserva v7/43 y lectores históricos. Presupuestos19 proveedor/62 total y25 control, entregas/admisiones/backend aparte. Solo documentos/borrador, sin implementar/permisos/SQL/env/red/activación o nueva infraestructura; ver AC y tareas CAPP.

## IA-ADR01: mismo despliegue y persistencia DB — 29/10/2026

[Integración app](s00/instantly-app-integration.md) implementada offline: receptor puro en src/lib/server/instantly, wrapper S00 compatible, puerto RPC con CAS/retry de conflicto único y migración046 con dos tablas técnicas/RLS/grants backend. Ruta webhook nodejs usa APP_ORIGIN canónico y secreto antes de DB, sin confiar en forwarded host; control interno requiere superadmin/MFA/checkOrigin. Ningún job/evento comercial o API key Instantly en la entrada. Docker/worker originales no cambian; featurefalse no abre cliente DB.19 nuevos/423 regresión/DB/TS, sin entorno remoto o source43 modificados. Runbook y presupuesto real pendientes de autorización/comprobación; no conmutar CLI local al VPS automáticamente.

## INS-C-ADR01: receptor técnico aislado y continuidad43 — 29/10/2026

**Implementado offline:** core C, handler Request/Response/receipt store atomic/lock, v8/files/CLI y transporte exclusivo de webhooks sobre bounded transport; A/B conservan allowlist/códigos. C usa Date.now absoluto para ventana120s/logs; A/B performance.now sin cambios. Secretos futuros dedicados ligados por hash a manifiesto, HMAC local para replay/correlación sin guardar body, conflicto tardío produce partial y no reescribe recibos. CLI preview/status/replay sin env/red/save; gates19/62 y endpoint/cupo incluidos antes de efectos.28 C/400 S00 y TS correctos; source43 sin migrar, no endpoint/listener o integración CRM/S01 desplegada. Descripción inicial siguiente conserva la propuesta.

[Diseño C](s00/instantly-phase-c.md): handler inyectable Node/TS con header secreto dedicado sobre HTTPS, recibo mínimo durable antes de2xx, dedup técnica y cuarentena de contexto sintético/ajeno, sin negocio CRM. No reutilizar Gmail push ni desplegar infraestructura ahora; usuario confirmó que falta receptor público. Propuesta v8/phase C encapsula v7 completed43 íntegro en el mismo journal, no otro contador ni reapertura BR28. Reusar transporte/SC/locks; nuevo core/handler y extensiones files/CLI solo tras solicitud de implementación. Allowlist de webhook propio/create/test único/GET/logs/DELETE, sin PATCH de campaña/leads o envíos.12–14 normales, máximo19 nuevas/62; G4/G5/permiso externo pendientes, cero cambios de código o privados hoy.

## INS-BR28-ADR01: v7 implementada con configuración conservada — 29/10/2026

**Estado real posterior:** v7 completed43/stage13,15 requests N/normal/OK y fuente v6/28 inmutable. Misma configuración, ningún PATCH de campaña, dos leads propios y PATCH de variables A con B aislado; cierre pausado. Tres páginas de audiencia incluyeron tercera vacía terminal. Sin R/H/efectos de emergencia o nuevo código. [Resultado/semántica histórica](s00/instantly-b-recovery-from-28.md). Mantener v7 terminal, no restaurar28 para consumir remanente.

[Diseño BR28](s00/instantly-b-recovery-from-28.md) implementado offline: v7/B_RECOVERY_FROM_28 en mismo ledger encapsula v6 completed28/raw guard false y origen27/19/18/11/4/bindings originales. Contexto/payload/identidad/SC/snapshots/transportes de B compartidos, builder cerrado y13 etapas con current configurado/audiencia vacía antes de tres mutaciones de leads. No configure/PATCH campaña. N15/R3/H2 y máximo20/48, reserva previa/conciliación sin repetir write; cursor devuelto debe coincidir con último ID. Files/CLI/status/check reconocen7 y rechazan legacy/downgrade. Historial y extremo20/48 probados bajo64KiB.23 BR28/372 S00/TS correctos, sin v7 real/credenciales/APIs o migración de fuente28.

## INS-SC-ADR01: compatibilidad limitada y evidencia histórica estable — 29/10/2026

[Diseño SC](s00/instantly-sequence-contract-correction.md): helper puro compartido por B/BR acepta solo dos defaults days propios en forma de ensayo única; copias acotadas e igualdad profunda completa posterior, sin mutación in situ o normalización de otros campos. Payload sin cambios y ninguna migración de ledger. assertCampaign añade política de secuencia, CFD elige explícitamente request_exact para mantener guardPass/filas raw/v6 históricos; BD sigue exacto. Fixture CFD usa weeks sintético para seguir construyendo failed27 bajo el runtime actual. Código/tests/QA offline349/349 y TS, contador real28 intacto; no ejecutor de recuperación nuevo o llamadas autenticadas.

## INS-CFD-ADR01/02: lectura configurada y proyección privada — 29/10/2026

**Estado posterior real:** v6 completed28, snapshot v5 failed27 inmutable y7 archivos privados restantes sin cambios. Un GET/0 retry con identidad/tenant/pausa válidos. Proyección muestra delay_unit/pre_delay_unit adicionales en paso; comparación estructural actual de secuencia rechazada, horario/copy coinciden. No se cambia diseño/guardas o normaliza una respuesta para aprobarla. [Resultado/límites](s00/instantly-config-diagnostic.md). B/BR failed preservados, sin mutación de campaña.

[Diseño CFD implementado offline](s00/instantly-config-diagnostic.md): v6/B_CONFIG_DIAGNOSTIC en el mismo ledger encapsula exactamente v5 failed27, sin resets o permisos BR reutilizados. GET propio fijo, sin metadata extra; identidad antes de proyectar, source/manifiesto/scope/configuración ligados. Comparación contra payload configurado true y guarda OC,45 rutas fijas y extras solo por cantidad; subject/body igualdad/tipo sin contenido/longitud/hashes. Pausa distinta detiene sin reparación, mismatches actuales no prueban causa histórica.1 GET+1 retry máximo2/29 con reserva durable y terminales sin reanudar. Files/CLI aceptan v6 y bloquean downgrade/efectos legacy; preview no usa env/save/HTTP.23 CFD/339 S00/TS correctos. Ledger real sigue v5/27, sin migración o APIs reales.

## INS-BR-ADR01/02: continuidad propuesta sobre el mismo recurso — 29/10/2026

Estado real posterior: v5/BR failed27/stage5 con snapshot v4 completed19 inmutable, misma campaña. Transporte PATCH/GET configurado OK pero guarda semántica rechazada, emergencia verified_paused y0 leads. No cambio de código para normalizar una respuesta no conservada. Se requiere propuesta de diagnóstico por campo contra payload configurado con origen27; BD anterior no es compatible ni se usa el remanente para reabrir BR. [Evidencia](s00/instantly-b-recovery-incident.md).

Implementado offline: núcleo B_RECOVERY/v5 con prior v4/19 inmutable, operaciones/etapas y contadores monotónicos, reserva previa y N17/R3/H2. Contexto puro BTrialContext y validadores/payloads compartidos para evitar fabricar B históricos modificados; files/CLI reconocen v5 y bloquean todas las rutas legacy de efectos. Esquemas/huellas preservan representación anterior;64KiB existente suficiente en pruebas. Gate propio22/41, status/check sin env/save/red, write incierto se concilia por recurso propio sin duplicarlo.23 BR/316 S00 y TS correctos; v4 real aún19, sin migración real. [Detalle](s00/instantly-b-recovery.md).

[Diseño BR](s00/instantly-b-recovery.md): futura v5/B_RECOVERY conserva snapshot v4 completed19 y fuente B failed18; ID/nonce/manifiesto/scope fijados. Mismo files/lock/contador/CLI, helpers OC compartidos, sin reabrir terminales. Builder cerrado excluye create/search/activate/delete campaña, exige GET campaña pausada y lista inicial vacía antes de efectos. Normal N16–17/R3/H2, hasta22 nuevas/41 totales solo con permiso futuro. Writes inciertos se concilian por recurso propio; fallback pausa+GET de emergencia, sin borrar. Diseño preparado, no implementado o ejecutado; v4 real conserva19 y sus bytes.

## INS-OC-ADR01/02: contrato nullable/optional limitado al ensayo — 29/10/2026

[Diseño y decisiones OC](s00/instantly-optional-fields-correction.md): inspección pura fija de ai_sdr_id/is_evergreen/stop_for_company, sin valores privados/defaults; assertCampaign distingue conflicto/tipo inválido de desconocido y conserva guardas de identidad/listas/stop_on_reply/schedule/sequences, más estado0/2 independiente del mapeo. Informe B sendingSafetyCertified=false. Create incluye metadata ai_sdr_id=null; PATCH no envía esa propiedad fuera de su contrato documentado. Diagnóstico BD mantiene su comparación original; archivos/CLI/transiciones/esquemas de ledger no cambian y v4 completed19 no se reabre. No migración, nuevo contador/runner o dependencias.293/293 S00, TS y preservación de8 archivos correctos; sin red autenticada. Diseño de recuperación real pendiente, sin asumir defaults para envío.

## INS-BD-ADR01/02: extensión diagnóstica de lectura, sin reanudar B

[Contrato y ADR](s00/instantly-b-diagnostic.md). Reutilizar TS/Zod, payload esperado de B, transporte GET acotado y adaptador del mismo archivo. Futura v4/B_DIAGNOSTIC encapsula v3 failed18 completo, fijando source/manifiesto/scope;18→19/20, sin reponer H o ampliar36. CLI default soporta v4 y efectos legacy la rechazan; status/preview no leen env o escriben. Source exacto, configuración fijada e identidad del recurso antes de proyectar. Datos de respuesta exclusivamente en memoria: enum fijo de rutas/tipos/motivos y tamaños, sin IDs/valores/contenido arbitrario. Se exige pausa actual para completed del diagnóstico, sin corrección remota si cambió; B.failed e historicalFailureCauseProven=false permanecen explícitos.

Lock/temporales/monotonía existentes, reserva antes de cada GET,1 retry solo transitorio, backoff≥5s y timeout/stream compartidos. Fallos de almacenamiento o estados IN_FLIGHT no disparan replay. Migración ficticia, contraejemplos y CLI probados en28 casos BD/284 S00;8 fuentes operativas inmutables y18 reales conservadas. Sin dependencias o cambios de app/DB; la aceptación real y una eventual reparación requieren etapas posteriores.

## INS-B-ADR01/02 implementados offline — 27/10/2026

[Contrato técnico](s00/instantly-phase-b.md): núcleo B en el stack CLI/TS/Zod existente y transporte acotado compartido, sin dependencias nuevas. B utiliza el mismo ledger, futura versión3 con snapshot completo v2/11 y predecessor4, vinculada a constancia de scopes, configuración y manifiesto privado. Status no carga env ni escribe; gates separados new25/total36/included/reviewed; N20/R3/H2, reservas durables, conciliación sin repetir escrituras, pausa de emergencia solo del recurso propio. Replays terminales/interrumpidos no llaman APIs; los adaptadores antiguos rechazan downgrade.

Validación estricta de fuentes conserva su orden de serialización porque la constancia está ligada al hash del archivo guardado. Las comparaciones semánticas de payloads del proveedor usan orden canónico de propiedades; regresiones específicas distinguen ambos contratos. Campaña sin vías de envío, pausa acreditada y dos destinatarios controlados; mapeo de estados exige evidencia explícita del operador. La plantilla ficticia tiene confirmaciones false.29 pruebas B,256/256 S00 y TypeScript correctos; fuente/constancia reales idénticas, no migradas. Rollback local conserva journals/consumo; remota B/C/D pendiente y sin autorización nueva.

Versión 1.1 · 24 de octubre de 2026 · Estado: diseño consolidado con D01–D24; S00 local en ejecución, contratos externos por validar.

Este diseño implementaría los requisitos de [spec.md](spec.md) mediante cambios incrementales en el CRM existente. Las estructuras y rutas identificadas como propuestas todavía no existen. Este documento no es una migración ejecutable ni autoriza operaciones externas. Las tareas y verificaciones se detallan en [tasks.md](tasks.md).

## Arquitectura existente y evidencia

El manifiesto fija Next.js 16.3.8 App Router, React 19.3.0, TypeScript 7.0.2, Node 22 y pnpm 11.19.0. Supabase Postgres/Auth/Storage mantiene datos, MFA, RLS, archivos privados y funciones transaccionales; un worker independiente procesa `jobs` y `outbox`. ExcelJS y PapaParse cubren importaciones; los PDFs y el análisis financiero ya tienen servicios propios. No hay dependencias Composio/Instantly/TextTorrent en el manifiesto inspeccionado.

La guía instalada de Next.js sobre Route Handlers fue consultada para este diseño. Las nuevas rutas seguirían `src/app/api/**/route.ts`, con validación y autorización del servidor. Antes de implementar cambios concretos se deben consultar también las guías instaladas pertinentes, según AGENTS.md.

| Componente existente                                        | Evidencia y relación con el cambio                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/server/google.ts`                                  | OAuth por organización y llamadas Gmail autenticadas; punto de acoplamiento a abstraer.                                                                |
| `src/app/api/gmail/**`                                      | Conexión, callback, notificaciones, histórico y adjuntos; conservar compatibilidad durante migración.                                                  |
| `worker/gmail.ts`, `gmail-schedule.ts`, `gmail-archive.ts`  | Sincronización, envío, recuperación e histórico; mantener lógica de negocio y separar transporte.                                                      |
| `worker/index.ts`, `worker/db.ts`                           | Cola persistente, importación en bloques y ejecución; reutilizar reservas/fencing y programación.                                                      |
| `src/lib/server/mail-actions.ts`, `mail-manager.ts`         | Composición, destinatarios, firmas y archivos; deben dejar de asumir que todas las cuentas usan OAuth directo.                                         |
| `worker/campaigns.ts` y migraciones 039, 043, 045           | Audiencia elegible, secuencias y controles de campaña; evolucionar hacia coordinación multicanal.                                                      |
| `src/app/api/import/route.ts`, `src/lib/imports.ts`         | Actualmente se exige columna de correo; adaptar para teléfono sin correo utilizable.                                                                   |
| Migración 001 y evolución posterior                         | Contacto con correo único; `one_active_prospecting_sequence` por contacto y asociaciones Gmail. Revisar cada constraint vigente antes de proponer SQL. |
| `src/lib/domain.ts`, `financing-history.ts`                 | Etapas de oportunidad y estados de proceso ya distintos; no sustituir ambos por un único enum del mockup.                                              |
| Migraciones 027–038, `worker/underwriting.ts`               | Análisis con snapshots/revisión; actualmente requiere aplicación aprobada. Añadir propósito preliminar y validación final.                             |
| Migración 034 y `src/lib/server/mail-actions.ts`            | Paquetes documentales y solicitudes por lender; reutilizar versiones y cola para envíos aprobados.                                                     |
| Migración 042, `financing-control*`, `opportunity-signals*` | Métricas operativas e indicios de expediente; extender agregados con fuente verificable. Hay cambios locales previos en varios de estos archivos.      |
| `src/components/conversations-workspace.tsx`                | Conservar interacción, agrupación autorizada y asociación por cliente/proceso/lender; añadir canal e identidad.                                        |

La inspección local no confirma qué migraciones están instaladas en producción. S00 inventaría el estado real del ambiente actual autorizado, todavía sin uso, antes de numerar nuevas migraciones; no se exige preparar otro entorno. Ver [procedimiento](s00/environment.md). Los archivos locales previos quedan fuera de las modificaciones de esta fase documental.

## Decisiones de diseño

### AT01 Mantener una sola aplicación y las colas actuales

Navegador → Next.js → funciones autorizadas/Supabase → jobs/outbox → worker → adaptadores de proveedor. Los proveedores devuelven eventos o resultados que vuelven al mismo modelo de expediente y comunicaciones. No incorporar n8n, Redis, microservicios ni otra base por defecto: actualmente duplicarían orquestación, permisos y operación sin una necesidad demostrada.

### AT02 Separar identidad comercial y transporte

El buzón conserva su ID interno y sus permisos aunque cambie de OAuth directo a Composio. La marca operadora no es la empresa cliente. Instantly es un motor de campañas de correo, Composio gestiona acceso a buzones y TextTorrent aporta líneas y mensajes SMS. Una misma identidad de correo puede observarse en Composio e Instantly, pero no debe convertirse en dos buzones comerciales distintos.

Cada intento elige de forma explícita marca, endpoint autorizado, canal y adaptador de despacho. El LLM no elige una cuenta por nombre ni usa la primera conexión disponible.

### AT03 Un coordinador por contacto

Las campañas son contenedores y versiones de contenido. Las secuencias por lead representan los pasos de una campaña, y el coordinador común del contacto arbitra el momento/canal del siguiente intento entre marcas. Así se sustituye la restricción de una sola campaña activa por una restricción de despacho compatible con varios canales, sin quitar primero el control actual.

La distribución inicial se configura por porcentajes o filtros y se revisa antes de confirmar, según D15. Se calcula sobre leads elegibles y se guarda antes del primer envío; un reinicio no la recalcula. El reparto entero usa una regla determinista y documentada; los restos y conflictos de filtros se muestran en la vista previa. Si un lead no puede recibir por el canal asignado, queda para resolución en la revisión, sin cambio silencioso después de confirmar.

La política confirmada distingue no respuesta (48 horas desde el último envío confirmado) de interesado sin documentos (24 horas desde la última solicitud/recordatorio confirmado). El próximo envío ocurre en la primera ventana permitida posterior al vencimiento. Cada política exige máximo de intentos: en prospección se etiqueta como máximo total incluyendo el contacto inicial; la secuencia documental tiene su propio límite y derivación humana. Los intentos inciertos impiden avanzar hasta conciliación. Una pregunta del cliente que el equipo aún no respondió suspende recordatorios documentales.

El coordinador aplica frecuencia y consumo acumulado por contacto/objetivo entre todas las marcas y campañas. Cambiar marca, pausar/reanudar o reimportar no reinicia el presupuesto de intentos. Una replanificación requiere revisión explícita. Cadencias, máximos y calendario se versionan; no se adelantan automáticamente pasos aprobados al cambiar una configuración.

Una baja en cualquier canal impone bloqueo global de prospección para ese contacto en el grupo, invalida borradores comerciales y cancela seguimientos pendientes. El evento se propaga a Instantly y TextTorrent; los fallos de propagación generan alertas y conservan el bloqueo local. Si una secuencia externa no puede detenerse por contacto, aplicar la pausa segura validada en S00 antes de habilitar ese modo. Los mensajes ya en vuelo se concilian; no se promete retirarlos. Las comunicaciones de servicio ajenas a prospección requieren revisión explícita de propósito y permisos; no se habilita una excepción automática por etiquetar un mensaje como documental.

Hallazgo confirmado en S00: la migración 043 convierte toda campaña nueva creada por el comando actual en primer contacto con `steps=[]`. Las campañas históricas conservan sus secuencias. Por ello, S03 deberá introducir un modo de secuencia personal explícito y compatible para D05; pasar pasos al comando actual no basta. Mantener primer contacto como comportamiento predeterminado, la expectativa de `tests/database.ts` ya se corrigió en S00 y una prueba de actualización protege las secuencias históricas. En S03, probar ambas modalidades sin saltarse la autorización mediante funciones internas.

### AT04 Un asistente supervisado con autorización separada

Generar texto, mejorar ejemplos y autorizar envío son operaciones diferentes. Se empieza con un banco revisado de respuestas/correcciones y búsqueda simple sobre conocimiento autorizado, suficiente para el piloto. D19 incluye evaluar posteriormente entrenamiento específico con datos revisados, comparándolo con el mecanismo inicial. Evaluarlo no implica entrenar ni introducir una base vectorial por defecto; la recomendación puede ser conservar el enfoque inicial.

La autonomía se habilita por categoría, marca, canal y versión de política tras evaluación y aprobación del administrador. Decisiones financieras, condiciones contractuales y fondeo permanecen bajo responsabilidad humana. El asistente no modifica directamente etapas de financiación a partir de su propia conclusión.

## Modelo de datos propuesto

Los nombres siguientes son lógicos. Antes de crear tablas se comprobará si las estructuras actuales pueden ampliarse; no se duplican `messages`, documentos, tareas, procesos ni solicitudes que ya existen.

| Área                   | Cambio lógico propuesto                                                                                                                       | Integridad y acceso                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marcas                 | `operating_brands`; relación con buzones, líneas y campañas.                                                                                  | ID estable y estado; no reutilizar `companies`, que representa clientes.                                                                                                              |
| Acceso a marca         | Relación de disponibilidad para usuarios/equipo, cuando sea necesaria.                                                                        | Solo restringe lo que permiten los roles actuales; no concede expedientes ni área closer por sí sola.                                                                                 |
| Conexiones             | `integration_connections` con proveedor, scope de workspace/subcuenta, estado y referencia externa.                                           | Secretos solo en almacén cifrado/configuración de servidor; referencias visibles sin credenciales.                                                                                    |
| Buzones                | Ampliar `mail_accounts` con marca y referencia al conector activo; mapeo a Composio/Instantly.                                                | Mantener ID de cuenta, permisos y unicidad de identidad física dentro del ámbito correcto. Un solo escritor de correo personal por cuenta.                                            |
| Líneas SMS             | `sms_lines` con marca, subcuenta, número normalizado, capacidades y estado confirmado.                                                        | Número/capacidad verificables; permisos equivalentes de uso y expediente.                                                                                                             |
| Identidad del contacto | Correo opcional y teléfono normalizado; referencias a contactos y empresa existentes.                                                         | Sin correos ficticios para satisfacer NOT NULL. Índices parciales de correo no vacío, coincidencias telefónicas no equivalen automáticamente a una empresa.                           |
| Elegibilidad           | `contact_channel_eligibility` por contacto/canal y, cuando corresponda, marca/propósito.                                                      | Estado, razón, fuente, fecha, vigencia y revisión. Conservar `verifications` para Bouncer.                                                                                            |
| Bajas                  | Bloqueo global de prospección por contacto para todas las marcas y canales, compatible con `suppressions` actuales y replicado a proveedores. | Conservar fuente, fecha y evidencia. La baja no se levanta al reimportar/reconectar y no se estrecha al migrar; el uso de service role también debe comprobarla.                      |
| Secuencias             | `contact_journeys` o evolución de `campaign_enrollments`: objetivo, campaña, canal inicial, paso y política.                                  | Única pertenencia lógica por contacto/campaña/objetivo. Separar interesado, no respuesta y fidelización.                                                                              |
| Intentos               | `communication_attempts` como registro de coordinación, relacionado con outbox o despacho de campaña proveedor.                               | Clave única secuencia/paso/revisión; timestamps, ID externo, lease, estados, error y evidencia de confirmación. No es otra cola.                                                      |
| Eventos                | `integration_events` como bandeja durable de recepción y conciliación.                                                                        | Unicidad por conexión y event ID; cuando no existe, clave estable de entidad/revisión del proveedor. Guardar recepción/procesamiento y payload protegido con retención mínima.        |
| Referencias externas   | Relaciones entre entidades internas e IDs de proveedor, workspace y conexión.                                                                 | Unicidad compuesta por proveedor/scope/tipo/ID externo; nunca solo un ID externo global.                                                                                              |
| Conversaciones         | Ampliar `conversations`/`messages` o su proyección con canal y referencias externas.                                                          | Las restricciones Gmail se adaptan de forma aditiva; Gmail histórico conserva IDs/campos. Un SMS no inventa gmail_thread_id.                                                          |
| Asistente              | Borradores, decisiones humanas, ejemplos revisados y versiones/evaluaciones de política.                                                      | Hash de texto, contexto, destinatario, identidad y política; autor/revisor; ejemplos aislados por acceso y propósito.                                                                 |
| Riesgo                 | Propósito preliminar/final y snapshot de fuentes en ejecuciones actuales.                                                                     | Un preliminar no satisface la validación final ni el handoff. Revisión humana/versiones existentes se conservan.                                                                      |
| Aprobación a lenders   | Extender el paquete/solicitud actual con snapshot de aprobación humana, destinatarios y hashes.                                               | Paquete inmutable por envío; cambio relevante exige nueva aprobación para pendientes.                                                                                                 |
| Métricas/fidelización  | Participaciones y eventos de conversión enlazados a entidades actuales; tareas internas y registro manual de pagos/renovaciones.              | Fuente principal por última interacción significativa; fondeo global único. Pagos con autor/fecha/evidencia, sin inferir porcentaje por tiempo ni programar mensajes de fidelización. |

La creación de oportunidades hoy depende de correo válido. Para D04 se cambiará por una promoción transaccional basada en al menos un canal elegible, con razón y evidencia. La compatibilidad de filtros, contadores, RLS y campañas se prueba antes de habilitar SMS. Un lead sin canal elegible permanece en preparación, sin perder sus datos.

Documentos, análisis y aplicaciones actuales se relacionan principalmente con oportunidad/empresa; la atribución a procesos debe añadirse donde sea necesaria. Los históricos ambiguos conservan contexto general y pasan a revisión: no se copian automáticamente a todos los procesos ni se reutiliza un paquete para una renovación por coincidencia de cliente.

Índices candidatos: intentos por estado/next_at, secuencias por contacto/objetivo, mensajes por conversación/fecha, eventos pendientes por conexión/recepción y participaciones por campaña/fecha. Su diseño final exige consultas y planes de ejecución sobre volumen representativo. Todas las nuevas tablas operativas usan RLS; las funciones SECURITY DEFINER verifican actor, MFA, caso, área y endpoint y fijan search_path siguiendo el patrón del repositorio.

## Transiciones y vistas de operación

| Concepto nuevo                      | Reutilización prevista                                                                           | Regla                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Lead ingresado/por verificar        | Preparación de leads y resultados de canal.                                                      | No crear estado de financiación por una fila importada.                  |
| En campaña/sin respuesta/interesado | Secuencia, intentos, reply intent y tareas; proyectar `contacting`/`replied` cuando corresponda. | Confirmación de envío y respuesta con evidencia.                         |
| Falta aplicación/documentos         | `application_pending`, `documents_pending`, checklist y requisitos de proceso.                   | Vista por lo que falta, sin descartar otras tareas simultáneas.          |
| Riesgo preliminar/validación final  | Ejecuciones actuales con propósito/versiones; `analysis` y preparación existente.                | Preliminar no habilita entrega al closer/lenders.                        |
| Falta oferta/ofertas disponibles    | Procesos, `submissions` y `offers`.                                                              | Vistas solapables; las ofertas permanecen aunque el cliente rechace una. |
| Contratos enviados/firmados         | `processStates.contract_sent`/`contract_signed` y evidencia.                                     | No crear fondeo al firmar.                                               |
| Fondeado/fidelización               | Fondeo existente y proceso cerrado, más tareas de cliente.                                       | Renovación crea otro proceso.                                            |

Antes de SQL, S01 define por campo qué entidad es fuente de verdad. No mantener oportunidad y proceso avanzando automáticamente por reglas contradictorias.

## Integraciones y contratos

### Composio y recepción rápida

Mantener un adaptador compatible con la superficie Gmail que ya usan envío, lectura, adjuntos, firmas e histórico. Adaptadores propuestos: Gmail OAuth actual y Gmail a través de Composio. Los métodos de dominio no reciben ni exponen tokens de Google. Se selecciona siempre el connected account exacto y se verifica su buzón antes de activarlo.

La documentación oficial describe gestión de [cuentas conectadas](https://docs.composio.dev/docs/auth-configuration/connected-accounts) y [ejecución de API mediante proxy](https://docs.composio.dev/docs/tools-direct/executing-tools). Esto permite evaluar conservar operaciones Gmail específicas sin almacenar nuevos refresh tokens en la aplicación.

Para D06, S00 debe probar, por este orden:

1. Autenticación propia configurada en Composio y evento/consulta compatible con un intervalo cercano a un minuto, midiendo el ciclo completo y costo. La [documentación de intervalos](https://next.docs.composio.dev/reference/changelog) distingue la autenticación administrada de la propia; no se infiere un SLA de entrega a partir del intervalo.
2. Si no satisface el objetivo, evaluar reaprovechar Gmail watch/history y Pub/Sub con llamadas autenticadas por el adaptador. Es una alternativa condicionada a demostrar compatibilidad de proyecto OAuth/topic, scopes y conexión. No se promete que funcione con cualquier configuración Composio.

Las [notificaciones Gmail](https://developers.google.com/workspace/gmail/api/guides/push) requieren reconciliación para eventos demorados o perdidos. Preservar checkpoints, paginación, recuperación de historyId expirado y renovación de watch cuando se use. La prueba registra recepción en buzón, evento, persistencia y visibilidad, incluyendo p50/p95/máximo y exclusiones justificadas. Si no se logra el objetivo se informa el resultado y se revisa D06; no se declara aprobado usando 15 minutos silenciosamente.

Composio centraliza la autorización de buzones, pero Google sigue exigiendo consentimientos/scopes y posibles políticas de organización. Una credencial central del servidor no implica autorización automática a todos los correos ni volumen ilimitado.

### Instantly administrado desde CRM

Reutilizar el editor/plantillas actuales. Añadir proveedor de campaña, workspace, estado de sincronización y versión externa. Operaciones: publicar borrador, crear audiencia validada, activar/programar, pausar, leer eventos/respuestas/métricas y conciliar. El CRM conserva configuración deseada y el proveedor su ejecución observada. Cambios externos incompatibles se muestran para revisión antes de sobrescribir.

El [índice oficial de API](https://developer.instantly.ai/llms.txt) documenta campañas, leads, correo, métricas y webhooks. S00 verifica permisos del plan y contrato exacto de cada operación; la documentación pública no prueba acceso de esta cuenta.

La alternancia por lead exige comprobar cómo detener o mover un lead sin detener toda la audiencia. No inventar un endpoint de pausa individual. Si no puede demostrarse una suspensión segura de secuencias proveedor, usar campañas/pasos de un solo envío y liberar los siguientes pasos desde el coordinador CRM, o mantener el escenario bloqueado hasta acordar una solución. No dejar una secuencia autónoma de Instantly y otra del CRM compitiendo.

Los mensajes de Instantly pueden observarse también por Gmail/Composio. Almacenar la relación externa y conciliar contra buzón físico, IDs Gmail y Message-ID con contexto. Identificadores ambiguos van a revisión; no deduplicar solo por asunto o cuerpo. Conservar las observaciones originales aunque haya un mensaje canónico para conteo.

### TextTorrent

Implementar envío individual, campaña cuando sea compatible con coordinación, listado de líneas activas, lectura de conversaciones y consulta de estados/consumo por subcuenta. La [documentación oficial de SMS API](https://www.texttorrent.com/features/sms-api) publica recuperación por REST y no detalla un contrato completo de webhook entrante. Diseñar inicialmente consultas paginadas y reconciliación; activar webhook solo con contrato verificable, autenticación y reglas de reintento conocidas.

Guardar chat ID, message ID y referencia de entrega cuando exista. Paginar y aplicar ventanas/checkpoints con solape para cambios tardíos; relectura idempotente. Medir cuota y costo antes de fijar frecuencia. Validar número/capacidad/subcuenta/saldo y bajas antes de reservar y despachar. Una respuesta SMS puede continuar un expediente sin correo válido.

### Matriz de entradas y fallos

| Fuente                       | Autenticación                                                                         | Transformación y destino                                                         | Recuperación                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Evento Composio              | Verificación oficial de firma/identidad sobre cuerpo original según contrato probado. | Conexión autorizada → evento durable → lectura del buzón → mensaje canónico.     | Duplicados y replay; conciliación desde checkpoint.                                                      |
| Gmail Pub/Sub, si se utiliza | Verificación OIDC/audience/service account actual, ajustada a cuenta migrada.         | Notificación → job incremental; payload no equivale al cuerpo del mensaje.       | Renovación, checkpoint e histórico expirado.                                                             |
| Evento Instantly             | Método de autenticación documentado/probado en S00; no suponer HMAC inexistente.      | Workspace/campaign/lead IDs → evento durable → validación por API si hace falta. | Conciliación periódica; si la autenticidad no es verificable, no aceptar el evento como orden confiable. |
| Consulta TextTorrent         | Credencial de API/subcuenta exclusivamente servidor.                                  | Chat/mensaje/estado → evento normalizado → mensaje/intent/resultados.            | Rate limit, paginación, solape y replay.                                                                 |
| Acción humana                | Sesión MFA, origen y permisos actuales.                                               | Comando validado → recibo idempotente → job/outbox existente.                    | Recibo repetible, conflicto de versión y reintento seguro.                                               |

Los callbacks se limitan a validar y persistir antes de responder; el trabajo lento ocurre en el worker. Si no puede persistirse el evento se devuelve error para no confirmar una recepción perdida, cuando el contrato del proveedor admite reintento.

## Flujo transaccional de un intento

1. Seleccionar próximo paso vencido y reservar la coordinación del contacto/endpoint mediante lease y fencing en Postgres.
2. Verificar versión de campaña, política, audiencia, permisos de caso/área/endpoint, elegibilidad, bajas, respuesta vigente, horario, presupuesto y objetivo pendiente.
3. Crear o recuperar el intento por clave estable; registrar intención y relación a outbox antes de llamar a proveedor.
4. Volver a comprobar versión de contacto y cancelación inmediatamente antes del despacho. Una respuesta entrante incrementa la versión e invalida acciones antiguas.
5. Despachar por un solo adaptador. Guardar ID/respuesta externa y evidencia; si la respuesta se pierde, marcar incierto.
6. Conciliar el incierto por identificadores del proveedor. Reenviar solo si existe evidencia suficiente de que no se ejecutó, o decisión administrativa auditada.
7. Programar siguiente intento desde el envío confirmado y la política. Respuesta, baja o meta cumplida cancelan la secuencia pertinente y generan la próxima acción apropiada.

Claves internas propuestas: campaña/publicación/revisión; journey/paso/revisión para intento; provider/scope/event_id para recepción; solicitud/lender/paquete/aprobación para presentación. No se asume que un proveedor implemente estas claves como idempotency keys. Un timeout en creación de campaña también necesita conciliación, no una segunda creación automática.

Errores temporales admiten espera exponencial con variación y Retry-After donde exista. Errores de validación, remitente, elegibilidad o bajas no se reintentan sin cambio. Cuotas o saldo pausan la parte afectada. Reservas de presupuesto se concilian al confirmar/fallar; un intento incierto no libera automáticamente capacidad para un duplicado.

## Asistente y aprendizaje gradual

Entrada normalizada → clasificación/recuperación de contexto permitido → borrador → revisión humana → despacho por el coordinador. El envío no ocurre dentro de una herramienta de texto sin los controles de negocio.

Cada borrador guarda mensaje origen, contexto/versiones, acción, contenido, identidad, destinatarios, fuentes y política. Aprobar registra el hash exacto. Un mensaje nuevo, baja, cambio de destinatario, documento relevante o política invalida esa aprobación. La toma de control humana pausa el asistente de ese ámbito y muestra quién lo controla.

Los ejemplos revisados se minimizan y separan del log operativo. Se distingue una respuesta editada, una rechazada y una aprobada sin cambios; no se toma cualquier mensaje enviado como ejemplo correcto. La evaluación utiliza casos no empleados como ejemplos e incluye negativas, solicitudes de baja, ambigüedades, información ausente, prompt injection y cruces de marcas/permisos. La propia confianza declarada por el modelo no es el criterio de liberación.

Propuesta de progresión: supervisado completo → automatizar únicamente categorías de bajo riesgo aprobadas → ampliar por evidencia y autorización → volver a supervisado ante incidente o cambio incompatible. Los umbrales se fijan antes del piloto, con cero tolerancia en las pruebas a envíos sin permiso, bajas ignoradas o datos de otro expediente. No se promete que una tasa de aprobación alta garantice calidad en producción.

Reutilizar cifrado y registro de consumo actuales, creando configuración y presupuesto de chatbot separados de los de underwriting/extracción. No elegir un nuevo proveedor/modelo ni compartir credenciales por defecto. La configuración de credenciales se resolverá en la fase de implementación autorizada.

## Riesgo preliminar y paquete final

Ampliar la ejecución existente con propósito, fuentes suficientes por producto y datos faltantes. El preliminar permite analizar estados bancarios aprobados aun sin aplicación firmada y propone preguntas/datos por completar. No sustituye el requisito de verificación humana ni una decisión crediticia.

Aplicación completa, firma, requisitos aprobados y documentos vigentes permiten ejecutar/revisar el análisis final. El snapshot de presentación incluye análisis final aprobado, versión de aplicación, hashes documentales, guidelines utilizadas, destinatarios y aprobador. La operación de enviar verifica ese snapshot transaccionalmente.

La cola envía un paquete por solicitud/lender. Para portales sin API se conserva un flujo de tarea/evidencia manual; no se presenta un clic en enlace como envío automático confirmado. Seguimiento a lenders usa la identidad autorizada, plazos aprobados y hechos de la solicitud. Mensajes que proponen condiciones o negociación siguen sujetos a revisión humana.

## APIs y componentes afectados

Las rutas nuevas son propuestas y se consolidarán con las existentes para evitar endpoints duplicados.

| Superficie                                                  | Evolución prevista                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/api/import`, `/api/import/preview`, `/api/actions`        | Mapeo sin email obligatorio cuando hay teléfono, confirmaciones y comandos idempotentes de elegibilidad/distribución.               |
| `/api/integrations/*` propuesta                             | Estado, conexión, callback y comprobaciones de Composio/Instantly/TextTorrent; rutas Gmail antiguas compatibles durante transición. |
| `/api/integrations/events/*` propuesta                      | Recepción durable y autenticada de eventos verificados; TextTorrent inicialmente mediante worker polling.                           |
| `/api/campaigns/*`                                          | Proveedor, marca, publicación, audiencia, distribución, programación y reconciliación.                                              |
| `/api/conversations/*`, `/api/mail`                         | Proyección multicanal, SMS, referencias y cambios de transporte sin perder permisos actuales.                                       |
| `/api/assistant/*` propuesta                                | Borradores, revisión, control humano y versiones de autonomía; nunca credenciales al navegador.                                     |
| `/api/underwriting`, `/api/company-application`, documentos | Propósito preliminar/final, consistencia, firma y validación de paquetes.                                                           |
| Acciones lenders, métricas y configuración                  | Aprobación de lote, envíos por solicitud, atribución y fidelización con auditoría.                                                  |

Componentes principales: `crm.tsx`, `import-wizard.tsx`, `campaign-*`, `conversations-workspace.*`, `mail-*`, `integrations.tsx`, `opportunity-detail.tsx`, `underwriting-*`, `financing-control-*`, `financing-tracking-table.tsx` y `opportunity-signals*`. Extraer navegación y consultas de forma incremental donde el tamaño lo justifique, sin reescribir toda la pantalla principal.

## Interfaz y métricas

Aplicar el estilo del mockup: superficies claras, texto oscuro, acento verde, indicadores discretos y detalle progresivo. Los tokens exactos y fuentes se contrastan con el CSS existente; no introducir dependencia tipográfica obligatoria para usar la aplicación. Mantener ES/EN, estados vacíos/errores, foco y diseño móvil.

El inicio prioriza tareas reales. Las vistas operativas muestran motivo, siguiente acción, responsable y tiempo con evidencia; sus totales solapados no se suman como clientes únicos. El expediente se abre en panel conservando filtros, con alternativa accesible en móvil. Conversaciones mantiene su uso actual y añade filtros de canal/marca/estado del asistente. La aprobación de mensajes presenta contexto, identidad y destinatarios de forma visible.

Definir un diccionario de métricas antes de implementar agregados:

- Enviados: confirmados por el transporte/proveedor, con distinción entre aceptación y entrega SMS.
- Respondieron: contactos distintos con respuesta humana asociada después de envío; no total de mensajes ni auto replies.
- Aplicaciones: distinguir borrador, recibida, firmada y paquete validado.
- Ofertas: solicitudes/ofertas por proceso; separar recibidas, vigentes, rechazadas y vencidas.
- Deals/fondeo: operaciones con evidencia registrada, importe confirmado una sola vez en global.
- Participación: todas las participaciones son visibles y la fuente principal es la última interacción significativa verificable (D20). La cuenta emisora y el responsable comercial no son equivalentes.
- Salud: estado de conexión, permisos, última sincronización y cuota/saldo disponibles; no etiquetar un dominio como sano solo por tener pocos rebotes.

Para la atribución, versionar un catálogo de eventos significativos con evidencia de participación del cliente: respuesta humana validada o recepción de aplicación/documento con asociación verificable a origen. Excluir aperturas, auto replies y recordatorios salientes sin respuesta como único fundamento de una nueva fuente principal. Usar fecha efectiva del hecho, no fecha de ingestión; ordenar empates por identificador estable. Guardar el evento ganador y las participaciones en el snapshot de conversión. Un hecho posterior no reescribe la atribución histórica; una corrección justificada queda auditada. Sin asociación segura, mostrar fuente no confirmada en vez de asignar la última campaña por aproximación.

Las ofertas se comparan por monto/plazo solicitado, costo verificable y requisitos; los valores ausentes o no comparables permanecen explícitos. La recomendación presenta sus razones y necesita confirmación humana. No inventar tasas, convertir factores en una tasa anual sin metodología validada ni introducir un score ponderado con pesos no revisados.

La fidelización inicial (D22) utiliza tareas internas y captura manual de porcentaje pagado/renovaciones con fuente, autor y fecha. No crea envíos automáticos ni integra cobros/pagos. Una tarea de contacto muestra la baja cuando exista; no autoriza evadirla.

Agregación autorizada en servidor/Postgres sobre el universo completo antes de paginar. No generar tasas históricas a partir del estado actual; usar eventos y mostrar cobertura incompleta. Comparaciones de plantillas necesitan muestra y período comparables; las recomendaciones iniciales serán explicables, no un supuesto aprendizaje causal automático.

## Seguridad, compatibilidad y rollback

Usar controles de origen actuales para acciones humanas y autenticación específica para eventos, evitando aplicar una sesión web ficticia a callbacks. En cualquier petición del worker con service role, comprobar explícitamente el scope de conexión/caso/área; RLS no protege una consulta privilegiada por sí sola. Restricciones sobre entidades y referencias no se delegan al LLM.

Correos, SMS, HTML y archivos entrantes son datos no confiables. No ejecutar instrucciones extraídas de mensajes; conservar sanitización HTML, límites MIME/tamaño, previsualización aislada, cifrado y acceso temporal a archivos existentes. Entradas de ejemplos no pueden filtrar documentos de otro expediente o la fase closer a sellers.

Migrar de forma aditiva: tablas/campos opcionales → backfill auditado y ambiguos separados → lectura compatible → activar por cuenta/cohorte → nuevas restricciones tras verificar. La relajación del requisito de email debe probarse contra filtros, RPC y constraints anteriores. No eliminar índices/columnas antiguas hasta tener la sustitución activa y ensayada.

Banderas propuestas, todavía no implementadas: experiencia Pipeline OS, transporte Composio por cuenta, despacho Instantly/SMS, orquestación multicanal, asistente supervisado/autónomo, riesgo preliminar y fidelización. Desactivar una bandera pausa trabajos nuevos y pendientes que corresponda; no finge deshacer un envío aceptado por el proveedor.

Rollback operativo: pausar cohortes/proveedor/asistente, conservar eventos y outbox, conciliar inciertos, recuperar versión de aplicación compatible y seleccionar el conector anterior solo después de transferir el rol de escritor. Hacer backup antes de migrar y ensayar restauración en staging. Guardar siempre el snapshot de datos nuevos antes de una reversión SQL; una aplicación antigua puede necesitar parche de compatibilidad para contactos sin email, por lo que volver a un binario antiguo no es un rollback suficiente.

## Riesgos y condiciones para avanzar

| Riesgo                                                                             | Mitigación y prueba requerida                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Objetivo de un minuto incompatible con configuración Composio/Google disponible.   | Spike S00, medición y decisión antes de migración; bloquear recepción rápida si no se demuestra.            |
| Instantly no permite frenar una secuencia individual según el contrato disponible. | Probar control por lead o usar pasos liberados por CRM; no habilitar alternancia insegura.                  |
| Mismo buzón usado por Instantly y Composio supera cuota compartida.                | Presupuesto común con reserva, actividad externa conciliada y pausa cuando los datos están desactualizados. |
| SMS solo teléfono rompe RPC/RLS y vistas centradas en correo.                      | Migración aditiva, tests de todos los roles, importación y búsqueda; contactos ambiguos a revisión.         |
| Dos conectores duplican envíos, mensajes o métricas.                               | Un escritor por intento/cuenta, referencias canónicas, replay y reconciliación dual antes del corte.        |
| Supuesta autonomía aprende errores o pierde control humano.                        | Ejemplos revisados, evaluación separada, liberación explícita por categoría y rollback inmediato.           |
| Aplicación/riesgo/documentos de otro proceso se reutilizan sin autorización.       | Snapshot y ámbito por proceso, revisión de históricos ambiguos, invalidación al cambiar fuentes.            |
| Contratos API, planes, volumen o costo desconocidos.                               | Verificar en S00; no fijar capacidad ni costo a partir del mockup.                                          |
| Históricos insuficientes para tasas o estados.                                     | Mostrar cobertura y evidencia; no reconstruir conversiones sin fuente.                                      |

## Piloto, configuración y decisiones cerradas

El despliegue gradual comienza con 1 marca, 2 buzones, 1 línea SMS y hasta 500 leads (D23). La línea SMS se incorpora cuando pase sus pruebas; el primer piloto de correo D14 no espera S06. Los límites heredados de 50 MB/50.000 filas se conservan y se verifican con datos sintéticos aislados, sin campañas ni verificaciones pagas de ese tamaño.

D01–D24 cierran las decisiones funcionales de ambas rondas. Porcentajes, máximos, horarios, días permitidos, zona y presupuestos se ingresan como configuración obligatoria antes de activar una campaña; no se inventan valores al implementar. La definición de eventos significativos, reglas de redondeo y parámetros de comparación se documentan y prueban como decisiones técnicas trazables.

La evaluación posterior de entrenamiento específico compara una alternativa con el enfoque de ejemplos revisados utilizando casos reservados, calidad por categoría, edición humana, latencia, costo y restricciones de datos. Entrega una recomendación de entrenar o no entrenar. Cualquier entrenamiento real se describe después con conjunto aprobado, permisos, proveedor y presupuesto; esta planificación no lo ejecuta ni lo autoriza implícitamente.

## Verificación y estado de esta fase

La fase de planificación realizó revisión estática de manifiesto, instrucciones, código, migraciones y documentación oficial. La ejecución autorizada de S00 añade un [preflight offline y contrato de configuración](s00/README.md), sin conectar servicios ni alterar flujos de la aplicación. El informe S00 distingue pruebas locales realizadas, baseline corregido, compatibilidad histórica, carga persistida de 50.000 filas, 247 pruebas correctas y comprobaciones pendientes. Contratos reales, latencia, permisos remotos y despliegue siguen sin validación externa. La matriz general y el recorrido piloto permanecen en tasks.md.

## Comprobador S00 de conexiones (25 de octubre de 2026)

Se añade un módulo independiente del runtime Next/worker y un CLI con activación explícita, sin lector de archivos privados: [contrato y diseño](s00/connections.md). Solo seis GET de metadatos como máximo, hosts/rutas constantes, sin redirecciones/reintentos, límites de tiempo/tamaño y salida de campos fijos. El módulo no consume Supabase/Bouncer ni destinatarios. El estado de conexión no acredita ejecución de Gmail, acceso a todas las cuentas TextTorrent, permisos de campaña ni latencia. No requiere cambios de esquema, endpoints de aplicación, SDK o infraestructura.

## Inventario S00 y preparación de respuesta con scopes actuales

El inventario posterior usa otro CLI de metadatos limitado a 40 GET por ejecución, cinco páginas por listado, ruta/host fijos, aislamiento de cabeceras y resultados anónimos; no amplía el comprobador de seis conexiones ni reutiliza su permiso POST de identidad. Catálogo Supabase mediante SQL READ ONLY, separado de ledger y manifiesto local con hashes. [Diseño y evidencia](s00/inventory.md).

La definición GMAIL_REPLY_TO_THREAD versión 20261023_00 exige un scope de contactos ausente. Para el primer ensayo se propone proxy Composio hacia Gmail messages.send con MIME y threadId, conservando gmail.readonly/gmail.send. Permiso de proxy y resultado real pendientes; no hay cambios de adaptador, scope ni configuración. No se extraen tokens Google ni se infiere permiso de ejecución desde lectura de metadatos. El contrato de adjuntos del helper exige s3key, por lo que el primer ensayo usa PDF entrante y no promete subir una ruta local sin contrato. [Protocolo preparado](s00/composio-test-plan.md).

## S00-R01: ejecutor Gmail por proxy Composio

Decisión previa al código en [contrato del ejecutor](s00/composio-runner.md): proxy de cuenta explícita para profile, send MIME, thread y attachment base64. Evita contactos y S3 del helper, mantiene OAuth actual y no implementa S02. Módulo independiente, CLI por acciones, lock exclusivo y journal privado ignorado; reserva persistida antes de HTTP, errores sanitizados y presupuestos acumulados. Sin dependencias nuevas, tablas, rutas Next o cambios de worker. El endpoint de uso del proyecto devuelve consumo y no cupo mensual disponible.

### Revalidación S00 por permiso proxy

Separar huella de destino de huella completa de configuración. Solo prepare tras HTTP_403, sin perfiles/envíos/respuestas/polls, admite nueva clave con el destino original. Conservar token y presupuesto, revalidar configuración/conexiones antes de recuperar fase prepared. Migración del journal v1: vincular destino únicamente con la configuración original todavía coincidente; jamás derivarlo desde una clave ya cambiada sin esa prueba. Los intentos in_flight/sent/uncertain/failed no admiten este camino. La corrección de permisos requiere acción del usuario, no mutaciones remotas del ejecutor.

## Política de PDF proporcionados en S00

Una política persistida y flag explícito extienden únicamente el run autorizado a 40 solicitudes, máximo dos PDF por hilo y 10.000.000 bytes por archivo. Solo tras iniciales sent/perfiles correctos, sin confirmaciones/respuestas procesadas, desde prepared o bloqueo de ACK. Fingerprint/cuentas/destinatario/token/counters se preservan. Los adjuntos se leen vía los IDs Gmail de esos hilos, con cuerpo HTTP acotado a 14.000.000 bytes para su base64 y comprobación de longitud decodificada. Firma inicial PDF, tamaños MIME/API y SHA-256; bytes descartados, sin archivos/texto guardados. El journal conserva tamaños/huellas privadas; reporte público solo contadores y clase de validación. Las confirmaciones dicen recepción/checks de bytes sin afirmar análisis o hash de origen coincidente. Sin cambios de worker, esquema o aplicación.

## S00-A-ADR01: observación dirigida antes de integración CRM

[Contrato, decisión y riesgos](s00/composio-auto-receive.md): reutilizar helpers S00 en un observador opt-in con polling, metadata de dos hilos exactos, baseline de IDs anteriores, eventos únicos y tiempos de persistencia. El ejecutor actual omite respuestas ya procesadas; sus acciones no prueban detección nueva. Journal de observación separado conserva base histórica 37; el run previo se consulta sin sobrescribirlo. No activar worker Google/Supabase ni triggers Composio para aislar este ensayo. Validar query metadata/fields y presencia de internalDate, sin fallback a full/raw. Futuros tests deberán cubrir cuenta/propietario, presupuesto reservado, errores, reinicio y redacción. No hay cambios de arquitectura de producto, esquema, dependencias o código en esta planificación. Rollout/rollback y alternativa de triggers quedan documentados en el protocolo.

### S00-A: implementación y recuperación offline

Se extraen de s00-composio-runner.ts únicamente validación/configuración y HTTP acotado a s00-composio-common.ts; las 22 pruebas previas del runner conservan comportamiento. Nuevos observer/CLI/files usan reloj/fetch/store inyectables, esquema Zod existente y baseline de dos hilos; no hay dependencias nuevas. Estado persistente validado, reserva antes de HTTP, dos escrituras para tiempo de commit, locks origen→observación y creación temporal exclusiva seguida de fsync/rename. Error de disco interrumpe sin más red. Un reinicio activo no rearma ni reinicia budget; replay terminal no escribe o consulta. El CLI anterior rechaza red si existe ledger de observación para evitar saldo obsoleto. [Detalles y recuperación](s00/composio-auto-receive.md). Sin cambios de app/worker/esquema o configuración en vivo.

### S00-A: contrato metadata validado por proxy real

El ensayo autorizado aceptó consultas threads.get con format=metadata, headers fijos y proyección fields sin cuerpos/snippets/adjuntos, por cuenta/propietario explícitos. Baseline anterior y dos novedades se correlacionaron con los hilos originales; tiempos SMTP internalDate y commit local produjeron25.078/21.757ms. Dos relecturas preservaron eventos; source inmutable, locks liberados y ningún worker/suscripción persistente. Replay offline del journal terminal real no invocó fetch ni save. [Evidencia](verification.md); no generalizar a barrido completo de bandejas o procesamiento CRM durable.

## S00-B-ADR01: revocación explícita y recuperación por nuevo consentimiento

[Decisión y contrato](s00/composio-reconnect.md): evitar status/refresh deprecados y DELETE; proponer una revocación M1 y link v3.1 antes del corte. El enlace requiere HTTP201; no ampliar a ciegas el helper actual limitado a200/rutas de lectura. Ambas cuentas comparten user_id pero perfiles Gmail distintos: seleccionar por connected account ID y validar identidad de proveedor. Owner compartido no prueba duplicado. El SDK oficial hace comprobación de duplicados del lado cliente; REST link no documenta allow_multiple. No introducir SDK o sus requests implícitos.

Diseño futuro por fases con journal nuevo/base60 y locks en orden fijo; mutaciones reservadas antes de HTTP, resultado incierto conciliado sin repetir POST. Perfil correcto/hilo preservado preceden al binding M1 antiguo→candidate; Auth Config y M2 se conservan, no se alteran fingerprints históricos/env automáticamente. Compensación mediante consentimiento del mismo Gmail, no recuperación de tokens revocados. Link válido y reserva de recuperación antes de revocar; caso verifier/permiso desconocido bloquea el corte. Esta entrega solo modifica documentos.

### S00-B: transporte, persistencia y prueba offline implementados

Se conserva la allowlist de composioJson; boundedComposioJson comparte timeout8s, límite2.100.000B, fixed host, rechazo de redirecciones y parsing sanitizado, admite201 solo para link y ninguna ruta DELETE/PATCH. Módulo de reconexión aplica además allowlist de cuenta M1/candidate y cuerpos exactos. Parsing metadata exportado y construcción de query fija reutilizados por S00-A/B sin alterar su contrato. Sin dependencias o API Next nuevas.

Nuevos core/CLI/files: fase y presupuesto persisten antes de HTTP, categoría N21/R3/H4 y traces suman28/base60. Tres locks en orden origen→observación→reconexión; writes wx/fsync/rename, sin borrar locks ajenos o temporales huérfanos. Revoke/link no se reintentan; resultado incierto se concilia mediante acción explícita. El candidate y sus pruebas se invalidan al perder ACTIVE o cambiar de ID; proof histórico anterior no permite aprobar el nuevo. Binding M1 queda pausado y documentos/events previos inmutables. Estado completed se relee sin HTTP/escrituras, cierre de uso desconocido queda explícito. [Uso y recuperación](s00/composio-reconnect-runner.md).

## C-ADR01: corrección de identidad con continuidad de presupuesto

[S00-C/CR-S00-C01](s00/composio-m1-correction.md) propone extender el mismo ejecutor/registro a v2, conservando predecessor v1 validado y hash/base81 inmutables. Un bloque correction añade sus propios N≤13/R≤3 y máximo16/techo97, sin reponer H4 o permitir replay de mutaciones históricas. Status compatible v1/v2, acciones antiguas bloqueadas tras extensión, locks/atomicidad existentes; sin otro ledger autoritativo, dependencias o cambios de aplicación/DB. Diseño pendiente de implementación y QA.

Precheck local de dirección esperada comparada con huella M1 antes de API; si es M2/otra, abortar. Solo un nuevo link y OAuth humano con elección explícita de cuenta. Perfil válido M1 antes de consultar metadata; baseline conservado debe ser subconjunto, relectura final estable puede incluir nuevos mensajes legítimos sin descartarlos. Prueba específica para este cambio de criterio; B no se relaja silenciosamente. M2 original y uso al cierre, binding pausado; conexión equivocada M2 se conserva, limpieza fuera de alcance. No hay autorización de ejecución ni modificación actual de journals/env/configuración.

### Implementación C-T02/C-T03

[Core C](../../../scripts/pipeline-os/s00-composio-correction.ts) implementa schema v2 estricto con predecessor v1 validado/hash/base81, IDs originales privados, nuevos counters N13/R3, proofs y un enlace. Loader/CLI compartidos mantienen status v1/v2, lectura local explícita de target≤512B y texto privado de entrega atómico. Store impide downgrade/counters menores/cambio de snapshot o URL/TTL, y las acciones B se bloquean si existe v2. Se exporta la validación de fuentes B sin duplicarla; fixture B extraído a helper de tests sin efectos. Ningún SDK, dependencia, app o esquema nuevo.

Reservas HTTP y guardas por op/cuenta/ruta; post link sin retry, lectura segura reanudable una vez en R si se perdió proof por fallo de disco. Errores de cuenta/auth/metadata permanentes quedan sin reintentos al repetir acción. Metadata compartida valida cuerpo acotado/headers y conjunto baseline⊆histórico con relectura estable. Estado completed con binding pero sin uso final se diferencia de cierre completo; replay sin HTTP/escritura. Pruebas173/173 y TypeScript correctos, aceptación de proveedor real pendiente. [Uso y límites](s00/composio-correction-runner.md).

Ensayo real posterior autorizado: mismo journal v2, predecessor81 intacto, C11/N11/R0→total92, checks completos y binding paused=true. Perfil M1 e histórico correctos, M2 original validado antes/después; replay offline sin HTTP/escrituras. No se actualizan las variables históricas: el nuevo CA ID se resuelve desde binding v2 para futuras operaciones; el transporte M1 original sigue como lineage revocado. Limpieza de candidato M2 duplicado y activación CRM fuera de alcance. [Cierre](verification.md).

## INS-ADR01/02: validación aislada y control de seguimiento

[Protocolo Instantly](s00/instantly-validation.md), planificación sin código/API. Reutilizar patrones S00 y API v2 sin SDK, con transporte solo api.instantly.ai y journal propio por proveedor/fases; no ejecutar el inventario conjunto o ampliar su allowlist de lectura. Flags/gates por fase, fingerprints de clave/workspace/manifest, nonce/recursos propios, reservas N/R/H antes de HTTP y conciliación de mutaciones sin repetición ciega. Composio queda92 y sus registros no se alteran.

INS-B sin capacidad de emisión: no activate/resume/send-test/reply, email_list/tags/CC/BCC vacíos, estado no emisor acreditado antes de audiencia y dos contactos controlados con verificación deshabilitada. No inferir etiquetas de status numérico desde ejemplos genéricos. PATCH de variable de A solo acredita aislamiento, no pausa de scheduler. Mantener como alternativa prevista pasos únicos liberados por el coordinador CRM; pruebas de respuesta y detención real son una fase posterior con protocolo propio.

INS-C condicional: receiver HTTPS propio con secreto de header documentado, contexto workspace/campaña, persistencia/dedup y logs de entrega filtrados, un test sintético y cleanup del webhook propio autorizado. No inventar firma HMAC o usar evento sintético como respuesta real; deliveryID no equivale a messageID. Sin endpoint/infra pública nuevo hoy; futura integración en jobs/outbox corresponde a S05. Presupuestos separados A12/B25/C15, máximo conjunto52 propuesto, sin envíos ni autorización de ejecución por este documento.

### INS-A03: ejecutor de lectura independiente y recuperación conservadora

[Contrato técnico A](s00/instantly-phase-a.md). Núcleo `s00-instantly-runner.ts`, adaptador files y CLI separados; solo seis rutas GET de Instantly, sin reusar el inventario conjunto. Zod para estado/contratos, hash/error/Retry-After S00 existentes; ninguna dependencia nueva. Journal v1 privado por proveedor/fase, manifest del contrato, N10/R2 y trace IN_FLIGHT reservado antes del HTTP. Rutas/queries construidas internamente, redirects manuales, límite 2MiB y timeout8s que también cubre stream; relojes/fetch inyectados en pruebas.

Decisión de seguridad: sin reanudación o reset automático de un journal existente, aunque falle o quede IN_FLIGHT. Preservar consumo y requerir revisión offline de recuperación; completado reproduce reporte sin HTTP/save. Lock wx, temporal wx+sync+rename, validación estricta y transiciones monotónicas. Sin persistir keys/cursors/correos/cuerpos/IDs de terceros. Los scopes de la clave exacta son declarados, no prueba de escritura efectiva; key403 solo deja desconocido. Límites diarios no son saldo; slots de contactos no son reserva. Cambios de binding/manifiesto bloquean. No DB, UI, worker o infraestructura en este incremento; rollback local conserva cualquier journal. B/C/D no implementados.

### INS-R-ADR01/02: excepción controlada con historial inmutable

[Diseño/AC/presupuesto](s00/instantly-pagination-recovery.md). El fallo real keys en4 no se reescribe: modo recover-pagination exige base exacta v1 failed/DUPLICATE_RECORD/checkpoint2/N4/R0, snapshot/hash/nonce/fingerprint, manifiesto v2 del mismo ledger y gate futuro A/new8/total12/included. El adaptador antiguo rechaza v2; el CLI default lo proyecta sin env/save/HTTP. Sin reset/reinicio de v2 terminal/interrumpido. La base real no se migra al implementar o consultar preview.

Módulo s00-instantly-recovery comparte transporte GET y transformaciones puras de plan/accounts/events/campaigns con v1; no SDK o API paralela. Diagnóstico de una muestra keys limit100 sin cursor: clasifica repeticiones/conflictos/coincidencia exacta en memoria, sin persistir valores; cualquier duplicado deja scopes desconocidos. La muestra no demuestra reparación del servidor. Refresh workspace/plan, cuentas/eventos/búsqueda por nonce completan6 nuevas normales; R2 compartida por siguientes páginas/retries mantiene global N10/R2/12. Acumulado4 más hasta8 nuevas, no un presupuesto reiniciado. Causa remota no demostrada; rollback conserva ledger y prueba histórica, sin downgrade.
